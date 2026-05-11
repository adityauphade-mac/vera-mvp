import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db';

export const runtime = 'nodejs';

/**
 * GET /api/schedules — list this tenant's schedules.
 *
 * Writes go through PUT/DELETE on /api/schedules/[cadence]. There is no
 * POST here on purpose: the natural key is (tenantId, cadence), so a
 * verb that distinguishes "first create" from "subsequent edit" would be
 * lying. PUT-as-upsert keeps the API and the UI honest.
 */

async function requireTenantId(): Promise<
  { ok: true; tenantId: number } | { ok: false; status: number; error: string }
> {
  const session = await auth();
  if (!session?.user?.email) {
    return { ok: false, status: 401, error: 'unauthorized' };
  }
  const tenantId = session.user.tenantId;
  if (typeof tenantId !== 'number') {
    return { ok: false, status: 403, error: 'no_tenant_binding' };
  }
  return { ok: true, tenantId };
}

export async function GET() {
  const tenant = await requireTenantId();
  if (!tenant.ok) {
    return NextResponse.json({ error: tenant.error }, { status: tenant.status });
  }
  const schedules = await db.schedule.findMany({
    where: { tenantId: tenant.tenantId },
    orderBy: { cadence: 'asc' },
  });
  return NextResponse.json({ schedules });
}
