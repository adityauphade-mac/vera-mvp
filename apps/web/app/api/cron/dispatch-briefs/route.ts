import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { computeNextRun, type Cadence } from '@/lib/cadence';
import { sendBrief } from '@/app/api/brief/send/route';
import { verifyCronAuth } from '@/lib/cron-auth';

export const runtime = 'nodejs';
export const maxDuration = 60;

/**
 * Cron dispatch endpoint. Triggered every 15 min by Upstash QStash, which
 * signs each request with a JWT in the `upstash-signature` header.
 * `verifyCronAuth` checks that signature against the QStash signing keys
 * and also accepts a legacy `Authorization: Bearer $CRON_SECRET` as a
 * fallback for manual / emergency triggering.
 *
 * ── At-most-once delivery ────────────────────────────────────────────────
 *
 * Order of operations per due schedule, in this exact sequence:
 *
 *   1. SELECT all schedules where enabled=true AND nextRunAt <= now.
 *   2. CLAIM each row by ATOMICALLY advancing nextRunAt — guarded by the
 *      original nextRunAt. Postgres' row-level lock on UPDATE means at
 *      most one writer wins. If the guard fails (count=0), another
 *      dispatch beat us to it; skip silently.
 *   3. Only after a successful claim, fire the email. The schedule has
 *      already been advanced, so a crash-after-send won't cause a retry
 *      on the next 15-minute poll.
 *   4. Write SendLog with the outcome (sent | failed).
 *
 * Guarantees:
 *   - Two concurrent dispatches that find the same due row will only
 *     fire ONE email. The losing claim returns count=0 and skips.
 *   - A crash anywhere after the claim leaves nextRunAt advanced, so
 *     the schedule does not re-fire until its next slot.
 *   - A failed Resend send is recorded but not retried automatically;
 *     the operator can retry via "Send now" if needed.
 *   - GitHub-cron drift up to ~14 min is tolerated: nextRunAt <= now
 *     finds anything overdue, so a delayed cron just fires it slightly
 *     late once.
 *
 * Trade-offs we accept:
 *   - Transient send failures (rate limit, network blip) will not retry
 *     until the next scheduled slot. We surface them in SendLog rather
 *     than implementing exponential backoff.
 *   - If GH cron is down for >24h the missed daily slots are skipped —
 *     computeNextRun walks forward to the next future candidate rather
 *     than firing every backlog slot at once.
 */

export async function POST(req: Request) {
  // --- Auth: QStash signature (preferred) or legacy Bearer (fallback) ---
  const auth = await verifyCronAuth(req);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const now = new Date();
  const due = await db.schedule.findMany({
    where: { enabled: true, nextRunAt: { lte: now } },
    include: { tenant: true },
    take: 100,
  });

  type DispatchResult =
    | { scheduleId: number; status: 'sent'; resendId?: string }
    | { scheduleId: number; status: 'failed'; error: string }
    | { scheduleId: number; status: 'skipped'; reason: 'already_claimed' };

  const results: DispatchResult[] = [];

  for (const sch of due) {
    // ── Step 1: Atomically claim the row ────────────────────────────
    // Compute the post-run nextRunAt and try to advance the row, but ONLY
    // if no concurrent dispatch has already advanced it. Postgres makes
    // this UPDATE atomic at the row level; updateMany returns count=1 if
    // we won, count=0 if we lost.
    const newNextRunAt = computeNextRun({
      cadence: sch.cadence as Cadence,
      timeLocal: sch.timeLocal,
      timezone: sch.timezone,
      dayOfWeek: sch.dayOfWeek,
      dayOfMonth: sch.dayOfMonth,
      fromDate: now,
    });

    const claim = await db.schedule.updateMany({
      where: {
        id: sch.id,
        // Optimistic lock: only succeeds if nextRunAt is still what we
        // SELECTed. If another dispatch already advanced it, count=0.
        nextRunAt: sch.nextRunAt,
        enabled: true,
      },
      data: {
        lastRunAt: now,
        nextRunAt: newNextRunAt,
      },
    });

    if (claim.count === 0) {
      // Another dispatch claimed this row first (or it was disabled
      // mid-flight). Skip — we never fire the email.
      results.push({
        scheduleId: sch.id,
        status: 'skipped',
        reason: 'already_claimed',
      });
      continue;
    }

    // ── Step 2: We own this dispatch. Fire the email. ────────────────
    // Call sendBrief in-process instead of doing an HTTP roundtrip —
    // avoids Vercel's deployment protection on hashed preview URLs and
    // skips the auth round-trip we'd otherwise need.
    let outcome:
      | { status: 'sent'; resendId?: string; pdfBytes?: number }
      | { status: 'failed'; error: string };
    try {
      const r = await sendBrief({
        to: sch.recipient,
        cadence: sch.cadence as Cadence,
      });
      if (r.ok) {
        outcome = { status: 'sent', resendId: r.id, pdfBytes: r.pdfBytes };
      } else {
        outcome = {
          status: 'failed',
          error: `${r.code}: ${r.message}`,
        };
      }
    } catch (e) {
      outcome = {
        status: 'failed',
        error: e instanceof Error ? e.message : String(e),
      };
    }

    // ── Step 3: Record the outcome. ──────────────────────────────────
    await db.sendLog.create({
      data: {
        tenantId: sch.tenantId,
        scheduleId: sch.id,
        cadence: sch.cadence,
        toEmail: sch.recipient,
        resendId: outcome.status === 'sent' ? outcome.resendId : undefined,
        pdfBytes: outcome.status === 'sent' ? outcome.pdfBytes : undefined,
        status: outcome.status,
        errorMessage: outcome.status === 'failed' ? outcome.error : undefined,
      },
    });

    if (outcome.status === 'sent') {
      results.push({
        scheduleId: sch.id,
        status: 'sent',
        resendId: outcome.resendId,
      });
    } else {
      results.push({
        scheduleId: sch.id,
        status: 'failed',
        error: outcome.error,
      });
    }
  }

  return NextResponse.json({
    dispatched: results.filter((r) => r.status === 'sent').length,
    failed: results.filter((r) => r.status === 'failed').length,
    skipped: results.filter((r) => r.status === 'skipped').length,
    total: results.length,
    results,
    at: now.toISOString(),
  });
}
