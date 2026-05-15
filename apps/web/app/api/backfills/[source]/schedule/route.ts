import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { computeNextRun, type Cadence } from '@/lib/cadence';
import { isBackfillSource } from '@/lib/backfill/sources';
import { withAuth } from '@/lib/auth-helpers';
import { recordAudit } from '@/lib/audit';
import { backfillScheduleWireSchema } from '@vera/types';

export const runtime = 'nodejs';

/**
 * PUT    /api/backfills/[source]/schedule — upsert schedule for this source
 * DELETE /api/backfills/[source]/schedule — remove it
 *
 * Mirrors /api/schedules/[cadence] but keyed on (tenant, source) instead of
 * (tenant, cadence). PUT is idempotent.
 *
 * Audit: every mutation emits one row with a pretty summary in the
 * `backfill` category — schedule_created / schedule_updated /
 * schedule_paused / schedule_resumed / schedule_deleted.
 */

const PutBodySchema = backfillScheduleWireSchema;

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

const SOURCE_LABEL: Record<string, string> = {
  rooflink_jobs: 'Rooflink jobs',
  rooflink_lineitems: 'Rooflink estimate line items',
};
function sourceLabel(source: string): string {
  return SOURCE_LABEL[source] ?? source;
}

type RouteContext = { params: Promise<{ source: string }> };

export async function PUT(req: Request, ctx: RouteContext) {
  return withAuth(async (audit) => {
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

    const { tenantId } = audit;
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
        recipients: parsed.data.recipients,
        enabled: parsed.data.enabled,
        nextRunAt,
      },
      update: {
        cadence: parsed.data.cadence,
        dayOfWeek,
        dayOfMonth,
        timeLocal,
        timezone: parsed.data.timezone,
        recipients: parsed.data.recipients,
        enabled: parsed.data.enabled,
        nextRunAt,
      },
    });

    // Audit: pick the pretty action verb from before/after.
    let action:
      | 'schedule_created'
      | 'schedule_updated'
      | 'schedule_paused'
      | 'schedule_resumed';
    let summary: string;
    const label = sourceLabel(source);
    if (!existing) {
      action = 'schedule_created';
      summary = `${label} backfill scheduled (${parsed.data.cadence}) → ${summarizeRecipients(saved.recipients)}`;
    } else if (existing.enabled && !saved.enabled) {
      action = 'schedule_paused';
      summary = `${label} backfill paused`;
    } else if (!existing.enabled && saved.enabled) {
      action = 'schedule_resumed';
      summary = `${label} backfill resumed`;
    } else {
      action = 'schedule_updated';
      const changes: string[] = [];
      if (existing.cadence !== saved.cadence)
        changes.push(`cadence → ${saved.cadence}`);
      if (existing.timeLocal !== saved.timeLocal)
        changes.push(`time → ${saved.timeLocal}`);
      if ((existing.dayOfWeek ?? null) !== (saved.dayOfWeek ?? null))
        changes.push(`day of week → ${saved.dayOfWeek}`);
      if ((existing.dayOfMonth ?? null) !== (saved.dayOfMonth ?? null))
        changes.push(`day of month → ${saved.dayOfMonth}`);
      if (!recipientsEqual(existing.recipients, saved.recipients))
        changes.push(`recipients → ${summarizeRecipients(saved.recipients)}`);
      summary = changes.length
        ? `${label} backfill: ${changes.join(', ')}`
        : `${label} backfill updated`;
    }

    await recordAudit(db, {
      tenantId,
      userId: audit.userId,
      userEmail: audit.userEmail,
      category: 'backfill',
      action,
      entityType: 'BackfillSchedule',
      entityId: String(saved.id),
      summary,
      details: { source, before: existing, after: saved },
    });

    return NextResponse.json(
      { schedule: saved },
      { status: existing ? 200 : 201 },
    );
  });
}

export async function DELETE(_req: Request, ctx: RouteContext) {
  return withAuth(async (audit) => {
    const { source: sourceRaw } = await ctx.params;
    if (!isBackfillSource(sourceRaw)) {
      return NextResponse.json({ error: 'invalid_source' }, { status: 400 });
    }
    const source = sourceRaw;

    const { tenantId } = audit;

    // Fetch before delete so the audit detail has the snapshot.
    const existing = await db.backfillSchedule.findUnique({
      where: { tenantId_source: { tenantId, source } },
    });
    if (!existing) {
      return NextResponse.json({ error: 'not_found' }, { status: 404 });
    }
    await db.backfillSchedule.deleteMany({
      where: { tenantId, source },
    });

    await recordAudit(db, {
      tenantId,
      userId: audit.userId,
      userEmail: audit.userEmail,
      category: 'backfill',
      action: 'schedule_deleted',
      entityType: 'BackfillSchedule',
      entityId: String(existing.id),
      summary: `${sourceLabel(source)} backfill schedule removed`,
      details: { source, before: existing },
    });

    return NextResponse.json({ deleted: true });
  });
}
