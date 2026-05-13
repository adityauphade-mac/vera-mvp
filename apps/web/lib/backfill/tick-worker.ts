import 'server-only';
import { db } from '@/lib/db';
import { isBackfillSource, BACKFILL_META, type BackfillSource } from './sources';
import { fetchBatch } from './rooflink';
import { publishNextTick } from './qstash';
import { sendEmail, isEmailConfigured } from '@/lib/email';
import {
  renderEmailLayout,
  renderSummaryTable,
  escapeEmailHtml,
  EMAIL_COLORS,
} from '@/lib/email-layout';
import { recordAudit } from '@/lib/audit';
import { invalidateDataSnapshot } from '@/lib/data';
import { invalidateWriteOffsSnapshot } from '@/lib/write-offs-data';
import { sanitizeBackfillError } from './error-display';

/**
 * Core tick logic. Pure-ish wrapper that:
 *   1. Atomically claims the run (optimistic lock on claimedAt) so a
 *      duplicate QStash delivery can't process the same cursor twice.
 *   2. Fetches one batch from Rooflink.
 *   3. Writes raw rows in a transaction, advances the cursor.
 *   4. If more work remains: publishes the next tick.
 *   5. If exhausted: promotes this dataVersion (atomic swap) and
 *      demotes prior versions of the same source.
 *
 * Errors:
 *   - On a non-transient failure, increments consecutiveErrors. After 2 in
 *     a row (matching backfill.py MAX_CONSECUTIVE_FAILURES = 2), marks
 *     the run failed and stops chaining.
 *   - Releases the claim on every exit path.
 */

const CLAIM_TTL_MS = 90_000; // > 60s function cap
const MAX_CONSECUTIVE_ERRORS = 2;

export interface TickResult {
  status:
    | 'progressed'
    | 'completed'
    | 'failed'
    | 'canceled'
    | 'skipped_locked'
    | 'skipped_not_running';
  itemsProcessed?: number;
  itemsTotal?: number;
  message?: string;
}

export async function runTick(
  runId: number,
  destinationUrl: string,
): Promise<TickResult> {
  // Step 1 — claim. updateMany returns count: only 1 winner per row.
  const claim = await db.backfillRun.updateMany({
    where: {
      id: runId,
      status: 'running',
      OR: [
        { claimedAt: null },
        { claimedAt: { lt: new Date(Date.now() - CLAIM_TTL_MS) } },
      ],
    },
    data: { claimedAt: new Date() },
  });
  if (claim.count === 0) {
    // Either another tick has the lock, or the run isn't in 'running'.
    // Check which to give a helpful return value.
    const row = await db.backfillRun.findUnique({ where: { id: runId } });
    if (!row) return { status: 'skipped_not_running', message: 'run_not_found' };
    if (row.status !== 'running') {
      return { status: 'skipped_not_running', message: `status=${row.status}` };
    }
    return { status: 'skipped_locked' };
  }

  const run = await db.backfillRun.findUnique({ where: { id: runId } });
  if (!run) return { status: 'skipped_not_running', message: 'run_disappeared' };

  if (!isBackfillSource(run.source)) {
    await releaseClaim(runId);
    await markFailed(runId, `unknown source: ${run.source}`);
    return { status: 'failed', message: `unknown source: ${run.source}` };
  }
  const source = run.source as BackfillSource;
  const meta = BACKFILL_META[source];

  try {
    // For incremental runs, the `syncedSince` watermark filters Rooflink
    // to only records edited after the previous successful sync.
    const since = run.mode === 'incremental' ? run.syncedSince : null;
    const batch = await fetchBatch(source, run.cursor ?? null, meta.batchSize, since);

    // Step 3 — write raw rows. Use a transaction so the cursor advance and
    // the row writes are atomic; if the function dies between, the next
    // tick re-runs from the previous cursor (idempotent because rows are
    // keyed on (rooflinkId, dataVersion)).
    //
    // We use `createMany` with `skipDuplicates: true` instead of looping
    // over `upsert`. Rationale:
    //   - dataVersion = run.id, so within a single run the natural key
    //     (rooflinkId, dataVersion) is genuinely unique per Rooflink item.
    //     There are no "updates" to perform — only inserts or no-ops on
    //     retry.
    //   - Serverless Postgres round-trip latency dominates (~100-200ms per
    //     query). For a 200-row batch, sequential upsert is ~30s+;
    //     createMany is one round-trip, regardless of batch size.
    //   - skipDuplicates handles the re-tick-after-partial-commit case
    //     cleanly: if the transaction crashed mid-write last time, the
    //     same rows are simply skipped on the retry, and the cursor
    //     advance lands atomically.
    //
    // The 30s timeout is now overkill but stays as defense-in-depth.
    const dataVersion = run.id;
    await db.$transaction(
      async (tx) => {
        if (batch.items.length > 0) {
          if (source === 'rooflink_jobs') {
            await tx.rawRooflinkJob.createMany({
              data: batch.items.map((item) => ({
                rooflinkId: item.id,
                dataVersion,
                payload: item.payload as object,
              })),
              skipDuplicates: true,
            });
          } else {
            await tx.rawRooflinkLineItems.createMany({
              data: batch.items.map((item) => ({
                estimateId: item.id,
                dataVersion,
                payload: item.payload as object,
              })),
              skipDuplicates: true,
            });
          }
        }

        await tx.backfillRun.update({
          where: { id: runId },
          data: {
            cursor: batch.nextCursor,
            itemsProcessed: { increment: batch.items.length },
            itemsTotal: batch.itemsTotal ?? run.itemsTotal,
            consecutiveErrors: 0,
            claimedAt: null, // release claim on success
          },
        });
      },
      { timeout: 30_000, maxWait: 5_000 },
    );

    if (batch.nextCursor === null) {
      // Done. Promote this dataVersion (different rules for full vs
      // incremental — see promote() below). Also advance the schedule's
      // high-watermark so the NEXT run can fetch only what changed since.
      await promote(source, runId, run.mode);
      await advanceWatermark(runId);
      return {
        status: 'completed',
        itemsProcessed: run.itemsProcessed + batch.items.length,
        itemsTotal: batch.itemsTotal ?? run.itemsTotal ?? undefined,
      };
    }

    // More work — chain.
    await publishNextTick({ runId, destinationUrl, delaySec: 1 });
    return {
      status: 'progressed',
      itemsProcessed: run.itemsProcessed + batch.items.length,
      itemsTotal: batch.itemsTotal ?? run.itemsTotal ?? undefined,
    };
  } catch (e) {
    // Stored error is the sanitized, user-safe summary — the failure banner
    // on /dashboard/scheduler renders it directly. The raw error is logged
    // to stdout for operators who need the stack trace.
    const userMsg = sanitizeBackfillError(e);
    // eslint-disable-next-line no-console
    console.error(`[backfill] tick error on run #${runId}:`, e);

    const next = await db.backfillRun.update({
      where: { id: runId },
      data: {
        errorCount: { increment: 1 },
        consecutiveErrors: { increment: 1 },
        lastError: userMsg,
        claimedAt: null,
      },
    });

    if (next.consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
      await markFailed(runId, userMsg);
      return { status: 'failed', message: userMsg };
    }

    // Below threshold: try again on the next tick.
    await publishNextTick({ runId, destinationUrl, delaySec: 5 });
    return { status: 'progressed', message: `transient: ${userMsg}` };
  }
}

async function releaseClaim(runId: number): Promise<void> {
  await db.backfillRun
    .update({ where: { id: runId }, data: { claimedAt: null } })
    .catch(() => {
      /* swallow — best-effort cleanup */
    });
}

async function markFailed(runId: number, reason: string): Promise<void> {
  const run = await db.backfillRun.update({
    where: { id: runId },
    data: {
      status: 'failed',
      finishedAt: new Date(),
      lastError: reason,
      claimedAt: null,
    },
  });
  // Audit: terminal-state transition. userId=null because the tick worker
  // runs as a system task (cron-triggered or chained from a manual run-now;
  // either way the failure isn't attributable to a user keystroke).
  await recordAudit(db, {
    tenantId: run.tenantId,
    userId: null,
    userEmail: null,
    category: 'backfill',
    action: 'run_failed',
    entityType: 'BackfillRun',
    entityId: String(run.id),
    summary: `${friendlySourceLabel(run.source)} backfill run #${run.id} failed`,
    details: {
      source: run.source,
      runId: run.id,
      mode: run.mode,
      itemsProcessed: run.itemsProcessed,
      itemsTotal: run.itemsTotal,
      reason,
    },
  });
  // Stdout log so failures are grep-able in `/tmp/vera-dev.log`.
  // eslint-disable-next-line no-console
  console.warn(
    `[backfill] run #${run.id} (${run.source}) FAILED at ${run.itemsProcessed}/${run.itemsTotal ?? '?'} rows: ${reason}`,
  );
  // Fire-and-forget the notification — never let an email failure
  // re-throw past markFailed (the run is already failed, that's the
  // important state to record).
  void notifyFailure(run.id, run.source, run.itemsProcessed, run.itemsTotal, reason).catch(
    (e) => {
      // eslint-disable-next-line no-console
      console.warn(`[backfill] failure-email crashed: ${e instanceof Error ? e.message : e}`);
    },
  );
}

/**
 * Email the tenant's user(s) when a run terminates in failure. Single-tenant
 * V1: there's one user per tenant; we send to all of them. No separately-
 * configured "ops email" — the logged-in user IS the recipient.
 *
 * Dev fallback: when RESEND_API_KEY is unset, logs the would-be email so
 * the failure path is visible without provisioning Resend locally.
 */
async function notifyFailure(
  runId: number,
  source: string,
  itemsProcessed: number,
  itemsTotal: number | null,
  reason: string,
): Promise<void> {
  const run = await db.backfillRun.findUnique({
    where: { id: runId },
    select: { tenantId: true },
  });
  if (!run) return;
  const users = await db.user.findMany({
    where: { tenantId: run.tenantId },
    select: { email: true },
  });
  if (users.length === 0) {
    // eslint-disable-next-line no-console
    console.warn(`[backfill] no users found for tenant ${run.tenantId}; skipping email`);
    return;
  }
  const recipients = users.map((u) => u.email);

  const sourceFriendly = friendlySourceLabel(source);
  const subject = `${sourceFriendly}: sync failed`;
  const progress = itemsTotal
    ? `${itemsProcessed.toLocaleString()} of ${itemsTotal.toLocaleString()} records`
    : `${itemsProcessed.toLocaleString()} ${itemsProcessed === 1 ? 'record' : 'records'}`;

  const html = renderEmailLayout({
    preheader: `${sourceFriendly} sync failed — retry available`,
    eyebrow: 'Vera · data sync failed',
    eyebrowColor: EMAIL_COLORS.heatCritical,
    headline: `${sourceFriendly} couldn't finish syncing`,
    introHtml: `The sync stopped before completing. Any records that landed before the failure are still in the database — <strong>nothing was lost</strong>. You can retry from the scheduler page.`,
    bodyHtml: `
      ${renderSummaryTable([
        ['Source', sourceFriendly],
        ['Progress before failing', progress],
        ['Run reference', `#${runId}`],
      ])}
      <p style="margin:18px 0 8px 0;font-size:13px;color:${EMAIL_COLORS.textSecondary};">What went wrong:</p>
      <pre style="margin:0;padding:12px;background:#FBEAEA;border-left:3px solid ${EMAIL_COLORS.heatCritical};border-radius:6px;font-size:12px;color:#3F362B;white-space:pre-wrap;word-break:break-word;font-family:Menlo,Monaco,'Courier New',monospace;">${escapeEmailHtml(reason)}</pre>
    `,
    cta: {
      href: `${process.env.NEXTAUTH_URL ?? 'http://localhost:3000'}/dashboard/scheduler`,
      label: 'Open scheduler',
    },
  });

  if (!isEmailConfigured()) {
    // eslint-disable-next-line no-console
    console.warn(
      `[backfill] email not configured (no RESEND_API_KEY) — would have sent "${subject}" to ${recipients.join(', ')}`,
    );
    return;
  }

  for (const to of recipients) {
    const result = await sendEmail({ to, subject, html });
    if (result.ok) {
      // eslint-disable-next-line no-console
      console.warn(`[backfill] failure email sent to ${to} (resend id: ${result.id})`);
    } else {
      // eslint-disable-next-line no-console
      console.warn(
        `[backfill] failure email to ${to} failed: ${result.reason === 'send_failed' ? result.message : result.reason}`,
      );
    }
  }
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Atomic promotion. Two modes:
 *
 *   - Full sync: this run REPLACES the snapshot. Demote all prior promoted
 *     runs for the source, then promote this one. Same as V1 behavior.
 *
 *   - Incremental sync: this run ADDS rows on top of the existing snapshot.
 *     Do NOT demote prior promoted runs — they're still live. Just promote
 *     this run too. Downstream queries use the merge view in
 *     `lib/backfill/merge-view.ts` to read "latest row per id" across all
 *     promoted versions.
 */
async function promote(
  source: BackfillSource,
  runId: number,
  mode: string,
): Promise<void> {
  if (mode === 'incremental') {
    await db.backfillRun.update({
      where: { id: runId },
      data: {
        status: 'completed',
        finishedAt: new Date(),
        promoted: true,
        claimedAt: null,
      },
    });
  } else {
    // Full sync — replace the snapshot.
    await db.$transaction([
      db.backfillRun.updateMany({
        where: {
          source,
          promoted: true,
          NOT: { id: runId },
        },
        data: { promoted: false },
      }),
      db.backfillRun.update({
        where: { id: runId },
        data: {
          status: 'completed',
          finishedAt: new Date(),
          promoted: true,
          claimedAt: null,
        },
      }),
    ]);
  }

  // Bust the in-process snapshot caches so the next dashboard request
  // recomputes from the freshly-promoted data. Per-instance only — Fluid
  // Compute instances that didn't promote will recompute on their next miss,
  // which is fine: cache key includes the promoted-run-id set, so any stale
  // slot will fail the version-key check and refresh.
  //
  // Look up the tenant first so the invalidation is correctly scoped.
  const promotedRun = await db.backfillRun.findUnique({
    where: { id: runId },
    select: { tenantId: true },
  });
  if (promotedRun) {
    invalidateDataSnapshot(promotedRun.tenantId);
    invalidateWriteOffsSnapshot(promotedRun.tenantId);
  }

  // Stdout log + success email — mirrors the failure path so all run
  // terminations are observable.
  const run = await db.backfillRun.findUnique({
    where: { id: runId },
    select: {
      id: true,
      tenantId: true,
      source: true,
      mode: true,
      itemsProcessed: true,
      itemsTotal: true,
      startedAt: true,
      finishedAt: true,
    },
  });
  if (!run) return;
  // Audit: terminal-state transition. Same userId=null reasoning as
  // markFailed — the worker is system-attributed regardless of whether
  // the originating Run-now was manual.
  await recordAudit(db, {
    tenantId: run.tenantId,
    userId: null,
    userEmail: null,
    category: 'backfill',
    action: 'run_completed',
    entityType: 'BackfillRun',
    entityId: String(run.id),
    summary: `${friendlySourceLabel(run.source)} ${run.mode} backfill completed (${run.itemsProcessed.toLocaleString()} ${run.itemsProcessed === 1 ? 'record' : 'records'})`,
    details: {
      source: run.source,
      runId: run.id,
      mode: run.mode,
      itemsProcessed: run.itemsProcessed,
      itemsTotal: run.itemsTotal,
      startedAt: run.startedAt?.toISOString() ?? null,
      finishedAt: run.finishedAt?.toISOString() ?? null,
    },
  });
  // eslint-disable-next-line no-console
  console.log(
    `[backfill] run #${run.id} (${run.source}) COMPLETED · ${run.itemsProcessed}/${run.itemsTotal ?? '?'} rows · mode=${run.mode}`,
  );
  void notifySuccess(run).catch((e) => {
    // eslint-disable-next-line no-console
    console.warn(`[backfill] success-email crashed: ${e instanceof Error ? e.message : e}`);
  });
}

/**
 * Email tenant users when a run completes cleanly. Same recipient resolution
 * as notifyFailure (all users on the tenant). When RESEND_API_KEY is unset
 * we log the would-be email rather than throw.
 */
/** Human-readable source labels. Never expose snake_case identifiers in
 *  user-facing surfaces (emails, alerts, UI). */
const SOURCE_LABEL: Record<string, string> = {
  rooflink_jobs: 'Rooflink jobs',
  rooflink_lineitems: 'Rooflink estimate line items',
};

function friendlySourceLabel(source: string): string {
  return SOURCE_LABEL[source] ?? source;
}

function formatDuration(startedAt: Date | null, finishedAt: Date | null): string {
  if (!startedAt || !finishedAt) return 'unknown';
  const sec = Math.round((finishedAt.getTime() - startedAt.getTime()) / 1000);
  if (sec < 1) return 'under a second';
  if (sec < 60) return `${sec} ${sec === 1 ? 'second' : 'seconds'}`;
  const min = Math.floor(sec / 60);
  const rem = sec % 60;
  return rem === 0 ? `${min} ${min === 1 ? 'minute' : 'minutes'}` : `${min}m ${rem}s`;
}

async function notifySuccess(run: {
  id: number;
  tenantId: number;
  source: string;
  mode: string;
  itemsProcessed: number;
  itemsTotal: number | null;
  startedAt: Date | null;
  finishedAt: Date | null;
}): Promise<void> {
  const users = await db.user.findMany({
    where: { tenantId: run.tenantId },
    select: { email: true },
  });
  if (users.length === 0) return;
  const recipients = users.map((u) => u.email);

  const sourceFriendly = friendlySourceLabel(run.source);
  const modeFriendly = run.mode === 'incremental' ? 'Incremental sync' : 'Full sync';
  const durationStr = formatDuration(run.startedAt, run.finishedAt);
  const isEmpty = run.itemsProcessed === 0 && run.mode === 'incremental';

  const subject = isEmpty
    ? `${sourceFriendly}: no new changes`
    : `${sourceFriendly}: ${run.itemsProcessed.toLocaleString()} ${run.itemsProcessed === 1 ? 'record' : 'records'} updated`;

  // Headline + intro vary by empty-state vs data-state.
  const headline = isEmpty
    ? 'Sync ran — nothing new to update'
    : `${run.itemsProcessed.toLocaleString()} ${run.itemsProcessed === 1 ? 'record was' : 'records were'} updated`;
  const intro = isEmpty
    ? `Vera checked Rooflink for changes since the last successful sync and found nothing new for <strong>${escapeHtml(sourceFriendly)}</strong>. No action needed.`
    : `Vera just finished a sync of <strong>${escapeHtml(sourceFriendly)}</strong>. Here's what was pulled in:`;

  const html = renderEmailLayout({
    preheader: isEmpty
      ? `No new ${sourceFriendly.toLowerCase()} since last sync`
      : `${run.itemsProcessed.toLocaleString()} ${sourceFriendly.toLowerCase()} updated`,
    eyebrow: 'Vera · data sync complete',
    headline,
    introHtml: intro,
    bodyHtml: renderSummaryTable([
      ['Source', sourceFriendly],
      ['Mode', modeFriendly],
      ['Records updated', run.itemsProcessed.toLocaleString()],
      ['Duration', durationStr],
      ['Run reference', `#${run.id}`],
    ]),
    cta: {
      href: `${process.env.NEXTAUTH_URL ?? 'http://localhost:3000'}/dashboard/scheduler`,
      label: 'Open scheduler',
    },
  });

  if (!isEmailConfigured()) {
    // eslint-disable-next-line no-console
    console.warn(
      `[backfill] email not configured (no RESEND_API_KEY) — would have sent "${subject}" to ${recipients.join(', ')}`,
    );
    return;
  }
  for (const to of recipients) {
    const result = await sendEmail({ to, subject, html });
    if (result.ok) {
      // eslint-disable-next-line no-console
      console.warn(`[backfill] success email sent to ${to} (resend id: ${result.id})`);
    } else {
      // eslint-disable-next-line no-console
      console.warn(
        `[backfill] success email to ${to} failed: ${result.reason === 'send_failed' ? result.message : result.reason}`,
      );
    }
  }
}

/**
 * Advance the BackfillSchedule's lastSyncedAt to this run's startedAt.
 * Also track lastFullSyncAt separately for full-sync runs so the UI can
 * surface "time since last full re-sync" and suggest periodic refreshes.
 *
 * `startedAt` (not `finishedAt`) on purpose: records edited DURING the run
 * may not have been captured. Setting the watermark to start time means
 * the next incremental run re-fetches anything edited from then forward,
 * including overlap, which is fine because writes are upserts.
 */
async function advanceWatermark(runId: number): Promise<void> {
  const run = await db.backfillRun.findUnique({
    where: { id: runId },
    select: {
      tenantId: true,
      source: true,
      mode: true,
      startedAt: true,
      scheduleId: true,
    },
  });
  if (!run || !run.startedAt) return;
  await db.backfillSchedule.updateMany({
    where: { tenantId: run.tenantId, source: run.source },
    data: {
      lastSyncedAt: run.startedAt,
      ...(run.mode === 'full' ? { lastFullSyncAt: run.startedAt } : {}),
    },
  });
}
