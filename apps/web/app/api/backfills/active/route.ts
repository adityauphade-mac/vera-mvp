import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db';

export const runtime = 'nodejs';

/**
 * GET /api/backfills/active — lightweight poll target.
 *
 * Returns only the in-flight runs (status = 'running' | 'queued') plus the
 * most recently-finished run per source so the UI can transition cards
 * from "Running" → "Completed N seconds ago" without a full refresh.
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

  const [active, recent] = await Promise.all([
    db.backfillRun.findMany({
      where: {
        tenantId: tenant.tenantId,
        status: { in: ['running', 'queued'] },
      },
      orderBy: { id: 'desc' },
    }),
    db.backfillRun.findMany({
      where: {
        tenantId: tenant.tenantId,
        status: { in: ['completed', 'failed', 'canceled'] },
      },
      orderBy: { finishedAt: 'desc' },
      take: 10,
    }),
  ]);

  return NextResponse.json({ active, recent });
}
