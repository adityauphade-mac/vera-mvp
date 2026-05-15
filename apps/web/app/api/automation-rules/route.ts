import { NextResponse } from 'next/server';
import { automationRuleSchema } from '@vera/types';
import { db } from '@/lib/db';
import { withAuth } from '@/lib/auth-helpers';
import { withSuppressedAutoAudit } from '@/lib/audit-context';
import { recordAudit } from '@/lib/audit';
import { evaluateRulesForTenant } from '@/lib/automation/evaluator';

export const runtime = 'nodejs';

/**
 * GET  /api/automation-rules — list rules for the current tenant.
 * POST /api/automation-rules — create a rule + bootstrap its evaluation state.
 *
 * The bootstrap step is a one-time call to evaluateRulesForTenant with
 * trigger='bootstrap' restricted to the new rule. It populates
 * RuleEvaluationState for every job in the AR working set with the current
 * baseline — so already-above-threshold jobs DON'T fire on the next sync.
 */

export async function GET() {
  return withAuth(async (audit) => {
    const rules = await db.automationRule.findMany({
      where: { tenantId: audit.tenantId },
      orderBy: { createdAt: 'desc' },
    });
    return NextResponse.json({ rules });
  });
}

export async function POST(req: Request) {
  return withAuth(async (audit) => {
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

    const rule = await withSuppressedAutoAudit(() =>
      db.automationRule.create({
        data: {
          tenantId: audit.tenantId,
          createdById: audit.userId ?? null,
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

    await recordAudit(db, {
      tenantId: audit.tenantId,
      userId: audit.userId,
      userEmail: audit.userEmail,
      category: 'automation_rules',
      action: 'created',
      entityType: 'AutomationRule',
      entityId: String(rule.id),
      summary: `Created rule "${rule.name}" (${describeCondition(rule)})`,
      details: { rule },
    });

    // Bootstrap — populate evaluation state without firing.
    try {
      await evaluateRulesForTenant({
        tenantId: audit.tenantId,
        trigger: 'bootstrap',
        ruleIds: [rule.id],
      });
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[automation] bootstrap evaluation failed', {
        ruleId: rule.id,
        err: err instanceof Error ? err.message : err,
      });
    }

    return NextResponse.json({ rule }, { status: 201 });
  });
}

/** Single-line summary like "heat_score crosses_above 80" for audit logs. */
function describeCondition(rule: {
  metric: string;
  operator: string;
  threshold: number;
  thresholdDays: number | null;
}): string {
  const op = rule.operator.replace(/_/g, ' ');
  const days =
    rule.operator === 'stays_above_for_n_days' && rule.thresholdDays
      ? ` for ${rule.thresholdDays} days`
      : '';
  return `${rule.metric.replace(/_/g, ' ')} ${op} ${rule.threshold}${days}`;
}
