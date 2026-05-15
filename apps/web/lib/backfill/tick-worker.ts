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
import { buildSyncSummaryData } from '@/lib/sync-summary-data';
import { renderSyncSummaryPDF } from '@/lib/sync-summary-pdf';
import { evaluateRulesForTenant } from '@/lib/automation/evaluator';
import { withSystemAuditContext } from '@/lib/audit-context';

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
/**
 * How many consecutive failed ticks to tolerate before marking a run failed.
 *
 * Each failed tick costs ~30-40s (Rooflink fetch timeout + 5s retry delay
 * before the next tick fires). At MAX_CONSECUTIVE_ERRORS = 5 we tolerate
 * roughly 2.5-3 minutes of upstream/network unreachability before giving
 * up — long enough to ride out a wifi handoff, a cell-tower switch, or a
 * short Rooflink WAF window, while still failing eventually if the issue
 * is sustained.
 *
 * Original value was 2 (matched the backfill.py Python script's
 * MAX_CONSECUTIVE_FAILURES). Bumped to 5 after observing repeated failures
 * on flaky/travelling networks: a single ~50s network blip was enough to
 * fail an otherwise-healthy 4-hour run, forcing manual resume.
 */
const MAX_CONSECUTIVE_ERRORS = 5;

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

      // Fire automation-rule evaluation against the now-promoted dataset.
      // Wrapped in try/catch so a misbehaving rule cannot retroactively
      // poison a successful backfill — the run still reports as completed
      // and the next tick chain remains intact.
      try {
        await withSystemAuditContext({ tenantId: run.tenantId }, () =>
          evaluateRulesForTenant({
            tenantId: run.tenantId,
            trigger: 'sync',
          }),
        );
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error('[automation] evaluation after backfill promotion failed', {
          runId,
          source,
          err: err instanceof Error ? err.message : err,
        });
      }

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
 * Look up the configured recipient list for a (tenant, source) pair from
 * `BackfillSchedule.recipients`. If none is configured (no schedule row, or
 * empty list), emit a `backfill.notification_skipped_no_recipients` audit
 * row so the gap is visible in the audit log, then return empty.
 *
 * This applies to BOTH scheduled and manual (Run-now) syncs — the recipient
 * list is keyed on (tenant, source), not on who triggered the run.
 */
async function resolveSyncRecipients(
  tenantId: number,
  source: string,
  runId: number,
): Promise<string[]> {
  const schedule = await db.backfillSchedule.findUnique({
    where: { tenantId_source: { tenantId, source } },
    select: { recipients: true },
  });
  const recipients = schedule?.recipients ?? [];
  if (recipients.length === 0) {
    try {
      await recordAudit(db, {
        tenantId,
        userId: null,
        userEmail: null,
        category: 'backfill',
        action: 'notification_skipped_no_recipients',
        entityType: 'BackfillRun',
        entityId: String(runId),
        summary: `${friendlySourceLabel(source)} sync notification skipped — no recipients configured`,
        details: { source, runId },
      });
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn(
        `[backfill] failed to audit notification skip for run #${runId}: ${e instanceof Error ? e.message : e}`,
      );
    }
  }
  return recipients;
}

/**
 * Email the configured sync recipients when a run terminates in failure.
 * Recipients come from `BackfillSchedule.recipients`; if unset, the email
 * is skipped and the skip is recorded in the audit log.
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
  const recipients = await resolveSyncRecipients(run.tenantId, source, runId);
  if (recipients.length === 0) return;

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

  const result = await sendEmail({ to: recipients, subject, html });
  if (result.ok) {
    // eslint-disable-next-line no-console
    console.warn(
      `[backfill] failure email sent to ${recipients.join(', ')} (resend id: ${result.id})`,
    );
  } else {
    // eslint-disable-next-line no-console
    console.warn(
      `[backfill] failure email to ${recipients.join(', ')} failed: ${result.reason === 'send_failed' ? result.message : result.reason}`,
    );
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
    // Empty-incremental short-circuit: if this incremental run wrote zero
    // rows, there's nothing to promote. Skipping the promote also skips
    // the REFRESH MATERIALIZED VIEW (~3s) and the success notification,
    // which would otherwise fire for every quiet sync (≈ every few
    // minutes in prod). The run still completes cleanly.
    const probe = await db.backfillRun.findUnique({
      where: { id: runId },
      select: { itemsProcessed: true },
    });
    if (probe && probe.itemsProcessed === 0) {
      await db.backfillRun.update({
        where: { id: runId },
        data: {
          status: 'completed',
          finishedAt: new Date(),
          claimedAt: null,
          // promoted: false (default) — explicitly NOT promoting.
        },
      });
      // eslint-disable-next-line no-console
      console.warn(
        `[backfill] run #${runId} (${source}) completed with 0 new rows — skipping promote/refresh/notify`,
      );
      return;
    }
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

  // Refresh the LiveJob materialized view if this was a rooflink_jobs promote.
  // Reads of the AR / write-offs paths now go through LiveJob (see
  // merge-view.ts), so the view has to reflect the freshly-promoted rows
  // before we bust the application caches.
  //
  // CONCURRENTLY keeps the view readable during the refresh (no exclusive
  // lock). Requires the unique index defined in the migration. It costs
  // roughly the same as the old DISTINCT ON query (~1s on 100k rows) but
  // happens here, not on a user-facing request.
  if (source === 'rooflink_jobs') {
    try {
      await db.$executeRawUnsafe(`REFRESH MATERIALIZED VIEW CONCURRENTLY "LiveJob"`);
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error(
        `[backfill] LiveJob refresh failed after run #${runId}: ${e instanceof Error ? e.message : e}`,
      );
      // Don't fail the promote — the next refresh will catch up. The read
      // path also falls back to RawRooflinkJob if LiveJob is empty.
    }
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
  const recipients = await resolveSyncRecipients(run.tenantId, run.source, run.id);
  if (recipients.length === 0) return;

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

  // Empty incremental syncs skip the PDF — there are no records to list.
  // A PDF generation failure is non-fatal; we still send the email so the
  // operator at least knows the run finished.
  let pdfAttachment: { filename: string; content: Buffer } | null = null;
  if (!isEmpty) {
    try {
      const data = await buildSyncSummaryData(run.id);
      if (data && (data.jobRows.length > 0 || data.lineItemsRows.length > 0)) {
        const buffer = await renderSyncSummaryPDF(data);
        const dateStamp = (run.finishedAt ?? new Date()).toISOString().slice(0, 10);
        pdfAttachment = {
          filename: `vera-${run.source}-sync-${dateStamp}-run-${run.id}.pdf`,
          content: buffer,
        };
      }
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn(
        `[backfill] sync PDF generation failed for run #${run.id}: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }

  const summaryRows: Array<[string, string]> = [
    ['Source', sourceFriendly],
    ['Mode', modeFriendly],
    ['Records updated', run.itemsProcessed.toLocaleString()],
    ['Duration', durationStr],
    ['Run reference', `#${run.id}`],
  ];
  if (pdfAttachment) {
    summaryRows.push(['Attached report', `${pdfAttachment.filename}`]);
  }

  const html = renderEmailLayout({
    preheader: isEmpty
      ? `No new ${sourceFriendly.toLowerCase()} since last sync`
      : `${run.itemsProcessed.toLocaleString()} ${sourceFriendly.toLowerCase()} updated`,
    eyebrow: 'Vera · data sync complete',
    headline,
    introHtml: pdfAttachment
      ? `${intro} A PDF summary of the touched records is attached to this email.`
      : intro,
    bodyHtml: renderSummaryTable(summaryRows),
    cta: {
      href: `${process.env.NEXTAUTH_URL ?? 'http://localhost:3000'}/dashboard/scheduler`,
      label: 'Open scheduler',
    },
  });

  if (!isEmailConfigured()) {
    // eslint-disable-next-line no-console
    console.warn(
      `[backfill] email not configured (no RESEND_API_KEY) — would have sent "${subject}" to ${recipients.join(', ')}${pdfAttachment ? ` with ${pdfAttachment.filename} (${pdfAttachment.content.byteLength} bytes)` : ''}`,
    );
    return;
  }
  const result = await sendEmail({
    to: recipients,
    subject,
    html,
    attachments: pdfAttachment ? [pdfAttachment] : undefined,
  });
  if (result.ok) {
    // eslint-disable-next-line no-console
    console.warn(
      `[backfill] success email sent to ${recipients.join(', ')} (resend id: ${result.id}${pdfAttachment ? `, pdf ${pdfAttachment.content.byteLength}b` : ''})`,
    );
  } else {
    // eslint-disable-next-line no-console
    console.warn(
      `[backfill] success email to ${recipients.join(', ')} failed: ${result.reason === 'send_failed' ? result.message : result.reason}`,
    );
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
