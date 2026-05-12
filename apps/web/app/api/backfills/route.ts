import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db';
import { BACKFILL_SOURCES } from '@/lib/backfill/sources';

export const runtime = 'nodejs';

/**
 * GET /api/backfills — list backfill schedules + the latest run summary per
 * source for this tenant. Single round-trip the scheduler page uses to
 * populate the "Data sync" section.
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

export async function GET() {
  const tenant = await requireTenantId();
  if (!tenant.ok) {
    return NextResponse.json({ error: tenant.error }, { status: tenant.status });
  }

  const [schedules, latestRuns] = await Promise.all([
    db.backfillSchedule.findMany({
      where: { tenantId: tenant.tenantId },
      orderBy: { source: 'asc' },
    }),
    Promise.all(
      BACKFILL_SOURCES.map(async (source) => {
        const latest = await db.backfillRun.findFirst({
          where: { tenantId: tenant.tenantId, source },
          orderBy: { id: 'desc' },
        });
        const lastPromoted = await db.backfillRun.findFirst({
          where: { tenantId: tenant.tenantId, source, promoted: true },
          orderBy: { id: 'desc' },
        });
        return { source, latest, lastPromoted };
      }),
    ),
  ]);

  return NextResponse.json({
    schedules,
    runs: latestRuns,
  });
}
