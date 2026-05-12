import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db';
import { isBackfillSource } from '@/lib/backfill/sources';
import { publishNextTick } from '@/lib/backfill/qstash';

export const runtime = 'nodejs';

/**
 * POST /api/backfills/[source]/runs — kick off a new run (Run-now path).
 *
 * Refuses (409) if a run is already in flight for this source. The cancel
 * endpoint must be used to terminate the existing run first.
 */

async function requireTenantId() {
  const session = await auth();
  if (!session?.user?.email) {
    return { ok: false as const, status: 401, error: 'unauthorized' };
  }
  const tenantId = session.user.tenantId;
  if (typeof tenantId !== 'number') {
    return { ok: false as const, status: 403, error: 'no_tenant_binding' };
  }
  return { ok: true as const, tenantId };
}

type RouteContext = { params: Promise<{ source: string }> };

export async function POST(req: Request, ctx: RouteContext) {
  const tenant = await requireTenantId();
  if (!tenant.ok) {
    return NextResponse.json({ error: tenant.error }, { status: tenant.status });
  }
  const { source: sourceRaw } = await ctx.params;
  if (!isBackfillSource(sourceRaw)) {
    return NextResponse.json({ error: 'invalid_source' }, { status: 400 });
  }
  const source = sourceRaw;
  const tenantId = tenant.tenantId;

  // Refuse if a queued/running run already exists for this source.
  const inflight = await db.backfillRun.findFirst({
    where: {
      tenantId,
      source,
      status: { in: ['queued', 'running'] },
    },
    orderBy: { id: 'desc' },
  });
  if (inflight) {
    return NextResponse.json(
      {
        error: 'already_running',
        message:
          'A run for this source is already in progress. Cancel it before starting a new one.',
        runId: inflight.id,
      },
      { status: 409 },
    );
  }

  // Decide mode: full unless the schedule has a watermark AND the caller
  // didn't force a full re-sync via `?mode=full`. The override is the
  // "Run as full sync" affordance in the UI — used for occasional schema /
  // deletion refresh.
  const url = new URL(req.url);
  const forceFull = url.searchParams.get('mode') === 'full';
  const schedule = await db.backfillSchedule.findUnique({
    where: { tenantId_source: { tenantId, source } },
  });
  const watermark = forceFull ? null : schedule?.lastSyncedAt ?? null;
  const mode: 'full' | 'incremental' = watermark ? 'incremental' : 'full';

  const run = await db.backfillRun.create({
    data: {
      tenantId,
      source,
      status: 'running',
      mode,
      syncedSince: watermark,
      scheduleId: schedule?.id ?? null,
      startedAt: new Date(),
    },
  });

  // Kick off the first tick. Build the absolute URL the chained ticks will
  // POST to — we pass it through so QStash (or the dev fallback) targets
  // the correct env (localhost in dev, the Vercel function URL in prod).
  const origin = new URL(req.url).origin;
  const destinationUrl = `${origin}/api/cron/backfill-tick`;
  await publishNextTick({ runId: run.id, destinationUrl, delaySec: 0 });

  return NextResponse.json({ run }, { status: 201 });
}
