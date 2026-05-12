import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db';
import { isBackfillSource } from '@/lib/backfill/sources';

export const runtime = 'nodejs';

/**
 * POST /api/backfills/[source]/runs/[id]/cancel — cancel an in-flight run.
 *
 * Per docs/BACKFILL_SCHEDULING.md §8 — hard delete the partial rows so
 * storage doesn't accumulate canceled-version garbage. The next tick that
 * wakes up sees status != 'running' and exits without doing work.
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

type RouteContext = { params: Promise<{ source: string; id: string }> };

export async function POST(_req: Request, ctx: RouteContext) {
  const tenant = await requireTenantId();
  if (!tenant.ok) {
    return NextResponse.json({ error: tenant.error }, { status: tenant.status });
  }
  const { source: sourceRaw, id: idRaw } = await ctx.params;
  if (!isBackfillSource(sourceRaw)) {
    return NextResponse.json({ error: 'invalid_source' }, { status: 400 });
  }
  const runId = Number(idRaw);
  if (!Number.isInteger(runId) || runId <= 0) {
    return NextResponse.json({ error: 'invalid_run_id' }, { status: 400 });
  }

  const run = await db.backfillRun.findUnique({ where: { id: runId } });
  if (!run || run.tenantId !== tenant.tenantId || run.source !== sourceRaw) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }
  if (run.status !== 'running' && run.status !== 'queued') {
    return NextResponse.json(
      { error: 'not_cancelable', message: `status=${run.status}` },
      { status: 409 },
    );
  }

  await db.$transaction([
    // Hard delete partial rows tagged with this dataVersion.
    db.rawRooflinkJob.deleteMany({ where: { dataVersion: runId } }),
    db.rawRooflinkLineItems.deleteMany({ where: { dataVersion: runId } }),
    db.backfillRun.update({
      where: { id: runId },
      data: {
        status: 'canceled',
        finishedAt: new Date(),
        claimedAt: null,
      },
    }),
  ]);

  return NextResponse.json({ canceled: true, runId });
}
