import { NextResponse } from 'next/server';
import { z } from 'zod';
import {
  dailyScheduleSchema,
  weeklyScheduleSchema,
  monthlyScheduleSchema,
} from '@vera/types';
import { db } from '@/lib/db';
import { computeNextRun, type Cadence } from '@/lib/cadence';
import { withAuth } from '@/lib/auth-helpers';
import { withSuppressedAutoAudit } from '@/lib/audit-context';
import { recordAudit } from '@/lib/audit';

export const runtime = 'nodejs';

/**
 * PUT    /api/schedules/[cadence] — upsert the schedule for this cadence.
 * DELETE /api/schedules/[cadence] — remove it.
 *
 * The natural key is (tenantId, cadence) — enforced by a Postgres unique
 * index. PUT is idempotent: same body twice ⇒ same final state.
 *
 * Audit: every mutation here emits one AuditLog row with a custom
 * pretty summary (paused / resumed / created / updated / deleted).
 * Auto-audit is suppressed inside the mutation block so we don't get
 * a duplicate generic "Schedule #23 updated" row alongside the pretty
 * "Daily AR brief paused" row.
 */

const CADENCES = ['daily', 'weekly', 'monthly'] as const;
type CadenceLiteral = (typeof CADENCES)[number];

/**
 * Cadence-specific PUT body schemas — built from the shared schemas in
 * `@vera/types` plus the `timezone` field that the browser supplies at runtime
 * (the form itself doesn't expose timezone; it's an IANA name resolved from
 * the user's browser). The `cadence` literal is supplied by the URL param, so
 * we omit it here.
 */
const dailyPutBody = dailyScheduleSchema
  .omit({ cadence: true })
  .extend({ timezone: z.string().min(1) });

const weeklyPutBody = weeklyScheduleSchema
  .omit({ cadence: true })
  .extend({ timezone: z.string().min(1) });

const monthlyPutBody = monthlyScheduleSchema
  .omit({ cadence: true })
  .extend({ timezone: z.string().min(1) });

/** Lower-case, trim, and dedupe the recipient list before persisting. */
function normalizeRecipients(arr: readonly string[]): string[] {
  return Array.from(new Set(arr.map((s) => s.trim().toLowerCase())));
}

function summarizeRecipients(list: readonly string[]): string {
  if (list.length === 0) return 'no recipients';
  if (list.length <= 3) return list.join(', ');
  return `${list.length} recipients (${list.slice(0, 2).join(', ')}, …)`;
}

function recipientsEqual(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  const sa = [...a].sort();
  const sb = [...b].sort();
  return sa.every((v, i) => v === sb[i]);
}

/**
 * The cron dispatcher only wakes every 5 min, so a non-grid time would
 * silently fire late. Snap to the 15-minute grid so the UI's
 * quarter-hour picker stays honest. Re-evaluate the granularity if we
 * ever offer finer-grained time picking.
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

function parseCadence(raw: string): CadenceLiteral | null {
  return (CADENCES as readonly string[]).includes(raw)
    ? (raw as CadenceLiteral)
    : null;
}

const CADENCE_LABEL: Record<CadenceLiteral, string> = {
  daily: 'Daily AR brief',
  weekly: 'Weekly summary',
  monthly: 'Monthly close',
};

type RouteContext = { params: Promise<{ cadence: string }> };

export async function PUT(req: Request, ctx: RouteContext) {
  return withAuth(async (audit) => {
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

    // Per-cadence parse so TS narrows each branch to a concrete shape.
    // The discriminated-union approach made `parsed.data` widen to `unknown`
    // when looked up via the lookup table — splitting here keeps the
    // Prisma upsert payload strongly typed.
    let timezone: string;
    let recipients: string[];
    let enabled: boolean;
    let timeLocalRaw: string;
    let dayOfWeek: number | null = null;
    let dayOfMonth: string | null = null;
    if (cadence === 'daily') {
      const parsed = dailyPutBody.safeParse(body);
      if (!parsed.success) {
        return NextResponse.json(
          { error: 'validation_error', issues: parsed.error.issues },
          { status: 400 },
        );
      }
      timezone = parsed.data.timezone;
      recipients = parsed.data.recipients;
      enabled = parsed.data.enabled;
      timeLocalRaw = parsed.data.timeLocal;
    } else if (cadence === 'weekly') {
      const parsed = weeklyPutBody.safeParse(body);
      if (!parsed.success) {
        return NextResponse.json(
          { error: 'validation_error', issues: parsed.error.issues },
          { status: 400 },
        );
      }
      timezone = parsed.data.timezone;
      recipients = parsed.data.recipients;
      enabled = parsed.data.enabled;
      timeLocalRaw = parsed.data.timeLocal;
      dayOfWeek = parsed.data.dayOfWeek;
    } else {
      const parsed = monthlyPutBody.safeParse(body);
      if (!parsed.success) {
        return NextResponse.json(
          { error: 'validation_error', issues: parsed.error.issues },
          { status: 400 },
        );
      }
      timezone = parsed.data.timezone;
      recipients = parsed.data.recipients;
      enabled = parsed.data.enabled;
      timeLocalRaw = parsed.data.timeLocal;
      dayOfMonth = parsed.data.dayOfMonth;
    }

    const { tenantId } = audit;
    const now = new Date();
    const timeLocal = snapTo15Min(timeLocalRaw);
    const recipientsNormalized = normalizeRecipients(recipients);

    const existing = await db.schedule.findUnique({
      where: { tenantId_cadence: { tenantId, cadence } },
    });

    const timingChanged =
      !existing ||
      existing.cadence !== cadence ||
      existing.timeLocal !== timeLocal ||
      existing.timezone !== timezone ||
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
            timezone,
            dayOfWeek,
            dayOfMonth,
            fromDate: now,
          });

    // Suppress auto-audit because we'll emit a pretty custom row below.
    const saved = await withSuppressedAutoAudit(() =>
      db.schedule.upsert({
        where: { tenantId_cadence: { tenantId, cadence } },
        create: {
          tenantId,
          cadence,
          dayOfWeek,
          dayOfMonth,
          timeLocal,
          timezone,
          recipients: recipientsNormalized,
          enabled,
          nextRunAt,
        },
        update: {
          dayOfWeek,
          dayOfMonth,
          timeLocal,
          timezone,
          recipients: recipientsNormalized,
          enabled,
          nextRunAt,
        },
      }),
    );

    // Compute the pretty action verb from the before/after.
    let action: 'created' | 'updated' | 'paused' | 'resumed';
    let summaryDetail: string;
    const label = CADENCE_LABEL[cadence];
    if (!existing) {
      action = 'created';
      summaryDetail = `${label} scheduled for ${summarizeRecipients(saved.recipients)}`;
    } else if (existing.enabled && !saved.enabled) {
      action = 'paused';
      summaryDetail = `${label} paused`;
    } else if (!existing.enabled && saved.enabled) {
      action = 'resumed';
      summaryDetail = `${label} resumed`;
    } else {
      action = 'updated';
      const changes: string[] = [];
      if (!recipientsEqual(existing.recipients, saved.recipients))
        changes.push(`recipients → ${summarizeRecipients(saved.recipients)}`);
      if (existing.timeLocal !== saved.timeLocal)
        changes.push(`time → ${saved.timeLocal}`);
      if ((existing.dayOfWeek ?? null) !== (saved.dayOfWeek ?? null))
        changes.push(`day of week → ${saved.dayOfWeek}`);
      if ((existing.dayOfMonth ?? null) !== (saved.dayOfMonth ?? null))
        changes.push(`day of month → ${saved.dayOfMonth}`);
      summaryDetail = changes.length
        ? `${label}: ${changes.join(', ')}`
        : `${label} updated`;
    }

    await recordAudit(db, {
      tenantId,
      userId: audit.userId,
      userEmail: audit.userEmail,
      category: 'schedule',
      action,
      entityType: 'Schedule',
      entityId: String(saved.id),
      summary: summaryDetail,
      details: {
        before: existing,
        after: saved,
      },
    });

    return NextResponse.json(
      { schedule: saved },
      { status: existing ? 200 : 201 },
    );
  });
}

export async function DELETE(_req: Request, ctx: RouteContext) {
  return withAuth(async (audit) => {
    const { cadence: cadenceRaw } = await ctx.params;
    const cadence = parseCadence(cadenceRaw);
    if (!cadence) {
      return NextResponse.json(
        { error: 'invalid_cadence', allowed: CADENCES },
        { status: 400 },
      );
    }

    const { tenantId } = audit;

    // Fetch the row first so the audit detail can record what was deleted.
    const existing = await db.schedule.findUnique({
      where: { tenantId_cadence: { tenantId, cadence } },
    });
    if (!existing) {
      return NextResponse.json({ error: 'not_found' }, { status: 404 });
    }

    await withSuppressedAutoAudit(() =>
      db.schedule.deleteMany({ where: { tenantId, cadence } }),
    );

    await recordAudit(db, {
      tenantId,
      userId: audit.userId,
      userEmail: audit.userEmail,
      category: 'schedule',
      action: 'deleted',
      entityType: 'Schedule',
      entityId: String(existing.id),
      summary: `${CADENCE_LABEL[cadence]} removed`,
      details: { before: existing },
    });

    return NextResponse.json({ deleted: true });
  });
}
