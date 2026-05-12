import { NextResponse } from 'next/server';
import { z } from 'zod';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db';

export const runtime = 'nodejs';

/**
 * GET  /api/notifications — returns the tenant's failure-notification setting
 * PUT  /api/notifications — upserts it
 *
 * Backs the "Failure notifications" card in /dashboard/scheduler.
 */

const PutBodySchema = z.object({
  opsEmail: z.string().email().nullable(),
});

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
  const row = await db.failureNotificationSetting.findUnique({
    where: { tenantId: tenant.tenantId },
  });
  return NextResponse.json({ setting: row });
}

export async function PUT(req: Request) {
  const tenant = await requireTenantId();
  if (!tenant.ok) {
    return NextResponse.json({ error: tenant.error }, { status: tenant.status });
  }
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
  }
  const parsed = PutBodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'validation_error', issues: parsed.error.issues },
      { status: 400 },
    );
  }

  const saved = await db.failureNotificationSetting.upsert({
    where: { tenantId: tenant.tenantId },
    create: { tenantId: tenant.tenantId, opsEmail: parsed.data.opsEmail },
    update: { opsEmail: parsed.data.opsEmail },
  });
  return NextResponse.json({ setting: saved });
}
