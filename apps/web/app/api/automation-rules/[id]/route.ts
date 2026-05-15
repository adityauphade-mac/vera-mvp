import { NextResponse } from 'next/server';
import { automationRuleSchema } from '@vera/types';
import { db } from '@/lib/db';
import { withAuth } from '@/lib/auth-helpers';
import { withSuppressedAutoAudit } from '@/lib/audit-context';
import { recordAudit } from '@/lib/audit';

export const runtime = 'nodejs';

type RouteContext = { params: Promise<{ id: string }> };

/**
 * GET    /api/automation-rules/[id] — fetch one rule (with eval state count).
 * PUT    /api/automation-rules/[id] — update a rule. Emits `updated` /
 *                                     `enabled` / `disabled` based on the
 *                                     before/after `enabled` flag.
 * DELETE /api/automation-rules/[id] — remove a rule. RuleEvaluationState and
 *                                     PendingRuleSend cascade.
 */

async function loadRule(id: number, tenantId: number) {
  return db.automationRule.findFirst({
    where: { id, tenantId },
  });
}

function parseId(raw: string): number | null {
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : null;
}

export async function GET(_req: Request, ctx: RouteContext) {
  return withAuth(async (audit) => {
    const { id: idRaw } = await ctx.params;
    const id = parseId(idRaw);
    if (id === null) {
      return NextResponse.json({ error: 'invalid_id' }, { status: 400 });
    }
    const rule = await loadRule(id, audit.tenantId);
    if (!rule) {
      return NextResponse.json({ error: 'not_found' }, { status: 404 });
    }
    return NextResponse.json({ rule });
  });
}

export async function PUT(req: Request, ctx: RouteContext) {
  return withAuth(async (audit) => {
    const { id: idRaw } = await ctx.params;
    const id = parseId(idRaw);
    if (id === null) {
      return NextResponse.json({ error: 'invalid_id' }, { status: 400 });
    }
    const existing = await loadRule(id, audit.tenantId);
    if (!existing) {
      return NextResponse.json({ error: 'not_found' }, { status: 404 });
    }

    let raw: unknown;
    try {
      raw = await req.json();
    } catch {
      return NextResponse.json(
        { error: { code: 'invalid_json', message: 'Body must be valid JSON.' } },
        { status: 400 },
      );
    }
    const parsed = automationRuleSchema.safeParse(raw);
    if (!parsed.success) {
      return NextResponse.json(
        {
          error: {
            code: 'validation_error',
            message: parsed.error.issues.map((i) => i.message).join('; '),
            issues: parsed.error.issues,
          },
        },
        { status: 400 },
      );
    }
    const values = parsed.data;

    const updated = await withSuppressedAutoAudit(() =>
      db.automationRule.update({
        where: { id },
        data: {
          name: values.name,
          metric: values.metric,
          operator: values.operator,
          threshold: values.threshold,
          thresholdDays: values.thresholdDays,
          recipientMode: values.recipientMode,
          recipientEmail: values.recipientEmail,
          subjectTemplate: values.subjectTemplate,
          bodyTemplate: values.bodyTemplate,
          dailySendCap: values.dailySendCap,
          enabled: values.enabled,
        },
      }),
    );

    // Pick the most specific action verb for the audit row. A pure
    // enabled/disabled flip gets its own action so the audit log can be
    // filtered.
    let action: 'updated' | 'enabled' | 'disabled' = 'updated';
    if (existing.enabled !== updated.enabled) {
      action = updated.enabled ? 'enabled' : 'disabled';
    }
    await recordAudit(db, {
      tenantId: audit.tenantId,
      userId: audit.userId,
      userEmail: audit.userEmail,
      category: 'automation_rules',
      action,
      entityType: 'AutomationRule',
      entityId: String(id),
      summary:
        action === 'enabled'
          ? `Enabled rule "${updated.name}"`
          : action === 'disabled'
            ? `Disabled rule "${updated.name}"`
            : `Updated rule "${updated.name}"`,
      details: { before: existing, after: updated },
    });

    return NextResponse.json({ rule: updated });
  });
}

export async function DELETE(_req: Request, ctx: RouteContext) {
  return withAuth(async (audit) => {
    const { id: idRaw } = await ctx.params;
    const id = parseId(idRaw);
    if (id === null) {
      return NextResponse.json({ error: 'invalid_id' }, { status: 400 });
    }
    const existing = await loadRule(id, audit.tenantId);
    if (!existing) {
      return NextResponse.json({ error: 'not_found' }, { status: 404 });
    }
    await withSuppressedAutoAudit(() =>
      db.automationRule.delete({ where: { id } }),
    );
    await recordAudit(db, {
      tenantId: audit.tenantId,
      userId: audit.userId,
      userEmail: audit.userEmail,
      category: 'automation_rules',
      action: 'deleted',
      entityType: 'AutomationRule',
      entityId: String(id),
      summary: `Deleted rule "${existing.name}"`,
      details: { rule: existing },
    });
    return NextResponse.json({ ok: true });
  });
}
