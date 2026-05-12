import { NextResponse } from 'next/server';
import { z } from 'zod';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db';
import { computeNextRun, type Cadence } from '@/lib/cadence';
import { isBackfillSource } from '@/lib/backfill/sources';

export const runtime = 'nodejs';

/**
 * PUT    /api/backfills/[source]/schedule — upsert schedule for this source
 * DELETE /api/backfills/[source]/schedule — remove it
 *
 * Mirrors /api/schedules/[cadence] but keyed on (tenant, source) instead of
 * (tenant, cadence). PUT is idempotent.
 */

const PutBodySchema = z.object({
  cadence: z.enum(['daily', 'weekly', 'monthly']),
  dayOfWeek: z.number().int().min(0).max(6).nullable().optional(),
  dayOfMonth: z.string().nullable().optional(),
  timeLocal: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  timezone: z.string().min(1),
  enabled: z.boolean().default(true),
});

function snapTo15Min(hhmm: string): string {
  const m = /^(\d{2}):(\d{2})$/.exec(hhmm);
  if (!m) return hhmm;
  const total = Number(m[1]) * 60 + Number(m[2]);
  const snapped = Math.round(total / 15) * 15;
  const wrapped = snapped % (24 * 60);
  return `${String(Math.floor(wrapped / 60)).padStart(2, '0')}:${String(
    wrapped % 60,
  ).padStart(2, '0')}`;
}

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

export async function PUT(req: Request, ctx: RouteContext) {
  const tenant = await requireTenantId();
  if (!tenant.ok) {
    return NextResponse.json({ error: tenant.error }, { status: tenant.status });
  }
  const { source: sourceRaw } = await ctx.params;
  if (!isBackfillSource(sourceRaw)) {
    return NextResponse.json({ error: 'invalid_source' }, { status: 400 });
  }
  const source = sourceRaw;

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

  const tenantId = tenant.tenantId;
  const now = new Date();
  const timeLocal = snapTo15Min(parsed.data.timeLocal);
  const dayOfWeek = parsed.data.dayOfWeek ?? null;
  const dayOfMonth = parsed.data.dayOfMonth ?? null;

  const existing = await db.backfillSchedule.findUnique({
    where: { tenantId_source: { tenantId, source } },
  });

  const timingChanged =
    !existing ||
    existing.cadence !== parsed.data.cadence ||
    existing.timeLocal !== timeLocal ||
    existing.timezone !== parsed.data.timezone ||
    (existing.dayOfWeek ?? null) !== dayOfWeek ||
    (existing.dayOfMonth ?? null) !== dayOfMonth;

  const existingNextRunFuture =
    !!existing?.nextRunAt && existing.nextRunAt.getTime() > now.getTime();

  const nextRunAt =
    !timingChanged && existingNextRunFuture && existing?.nextRunAt
      ? existing.nextRunAt
      : computeNextRun({
          cadence: parsed.data.cadence as Cadence,
          timeLocal,
          timezone: parsed.data.timezone,
          dayOfWeek,
          dayOfMonth,
          fromDate: now,
        });

  const saved = await db.backfillSchedule.upsert({
    where: { tenantId_source: { tenantId, source } },
    create: {
      tenantId,
      source,
      cadence: parsed.data.cadence,
      dayOfWeek,
      dayOfMonth,
      timeLocal,
      timezone: parsed.data.timezone,
      enabled: parsed.data.enabled,
      nextRunAt,
    },
    update: {
      cadence: parsed.data.cadence,
      dayOfWeek,
      dayOfMonth,
      timeLocal,
      timezone: parsed.data.timezone,
      enabled: parsed.data.enabled,
      nextRunAt,
    },
  });

  return NextResponse.json({ schedule: saved }, { status: existing ? 200 : 201 });
}

export async function DELETE(_req: Request, ctx: RouteContext) {
  const tenant = await requireTenantId();
  if (!tenant.ok) {
    return NextResponse.json({ error: tenant.error }, { status: tenant.status });
  }
  const { source: sourceRaw } = await ctx.params;
  if (!isBackfillSource(sourceRaw)) {
    return NextResponse.json({ error: 'invalid_source' }, { status: 400 });
  }

  const result = await db.backfillSchedule.deleteMany({
    where: { tenantId: tenant.tenantId, source: sourceRaw },
  });
  if (result.count === 0) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }
  return NextResponse.json({ deleted: true });
}
