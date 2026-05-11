import { NextResponse } from 'next/server';
import { z } from 'zod';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db';
import { computeNextRun, type Cadence } from '@/lib/cadence';

export const runtime = 'nodejs';

/**
 * PUT    /api/schedules/[cadence] — upsert the schedule for this cadence.
 * DELETE /api/schedules/[cadence] — remove it.
 *
 * The natural key is (tenantId, cadence) — enforced by a Postgres unique
 * index. PUT is idempotent: same body twice ⇒ same final state. This is
 * what makes "change recipient from aditya@ to nanda@" actually replace
 * the row instead of accumulating duplicates.
 *
 * `nextRunAt` rules:
 *   - On a fresh upsert: compute from scheduling fields, written verbatim.
 *   - On an edit where scheduling fields (cadence/time/timezone/day) are
 *     unchanged and the existing nextRunAt is still in the future:
 *     PRESERVE the existing nextRunAt. Changing the recipient or flipping
 *     `enabled` should not slide the next fire time.
 *   - Otherwise: recompute. Any change to a timing field means the user
 *     reshaped the schedule and expects the next slot to follow.
 */

const CADENCES = ['daily', 'weekly', 'monthly'] as const;
type CadenceLiteral = (typeof CADENCES)[number];

const PutBodySchema = z.object({
  dayOfWeek: z.number().int().min(0).max(6).nullable().optional(),
  dayOfMonth: z.string().nullable().optional(),
  timeLocal: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  timezone: z.string().min(1),
  recipient: z.string().email(),
  enabled: z.boolean().default(true),
});

/**
 * The cron dispatcher only wakes every 15 min, so a non-grid time would
 * silently fire late. Snap here so the persisted row matches what the
 * dispatcher will actually do — keeps the UI honest.
 */
function snapTo15Min(hhmm: string): string {
  const m = /^(\d{2}):(\d{2})$/.exec(hhmm);
  if (!m) return hhmm;
  const h = Number(m[1]);
  const min = Number(m[2]);
  const total = h * 60 + min;
  const snapped = Math.round(total / 15) * 15;
  const wrapped = snapped % (24 * 60);
  const sh = Math.floor(wrapped / 60);
  const sm = wrapped % 60;
  return `${String(sh).padStart(2, '0')}:${String(sm).padStart(2, '0')}`;
}

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

function parseCadence(raw: string): CadenceLiteral | null {
  return (CADENCES as readonly string[]).includes(raw)
    ? (raw as CadenceLiteral)
    : null;
}

type RouteContext = { params: Promise<{ cadence: string }> };

export async function PUT(req: Request, ctx: RouteContext) {
  const tenant = await requireTenantId();
  if (!tenant.ok) {
    return NextResponse.json({ error: tenant.error }, { status: tenant.status });
  }

  const { cadence: cadenceRaw } = await ctx.params;
  const cadence = parseCadence(cadenceRaw);
  if (!cadence) {
    return NextResponse.json(
      { error: 'invalid_cadence', allowed: CADENCES },
      { status: 400 },
    );
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

  const tenantId = tenant.tenantId;
  const now = new Date();
  const timeLocal = snapTo15Min(parsed.data.timeLocal);
  const dayOfWeek = parsed.data.dayOfWeek ?? null;
  const dayOfMonth = parsed.data.dayOfMonth ?? null;

  // Fetch the existing row (if any) to decide whether to preserve or
  // recompute nextRunAt. Cheap — unique-key lookup.
  const existing = await db.schedule.findUnique({
    where: { tenantId_cadence: { tenantId, cadence } },
  });

  const timingChanged =
    !existing ||
    existing.cadence !== cadence ||
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
          cadence: cadence as Cadence,
          timeLocal,
          timezone: parsed.data.timezone,
          dayOfWeek,
          dayOfMonth,
          fromDate: now,
        });

  const saved = await db.schedule.upsert({
    where: { tenantId_cadence: { tenantId, cadence } },
    create: {
      tenantId,
      cadence,
      dayOfWeek,
      dayOfMonth,
      timeLocal,
      timezone: parsed.data.timezone,
      recipient: parsed.data.recipient,
      enabled: parsed.data.enabled,
      nextRunAt,
    },
    update: {
      dayOfWeek,
      dayOfMonth,
      timeLocal,
      timezone: parsed.data.timezone,
      recipient: parsed.data.recipient,
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

  const { cadence: cadenceRaw } = await ctx.params;
  const cadence = parseCadence(cadenceRaw);
  if (!cadence) {
    return NextResponse.json(
      { error: 'invalid_cadence', allowed: CADENCES },
      { status: 400 },
    );
  }

  const tenantId = tenant.tenantId;
  const result = await db.schedule.deleteMany({
    where: { tenantId, cadence },
  });

  if (result.count === 0) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }
  return NextResponse.json({ deleted: true });
}
