import {
  evaluateAutomationRules,
  type EvaluableJob,
  type EvaluableRule,
  type Metric,
  type Operator,
  type PriorState,
  type RuleFire,
} from '@vera/domain';
import { db } from '@/lib/db';
import { getData } from '@/lib/data';
import { recordAudit } from '@/lib/audit';

/**
 * DB-side wrapper around the pure evaluator at @vera/domain. Loads rules +
 * AR working set + prior states, calls the evaluator, persists new states,
 * writes PendingRuleSend rows, and emits one audit row per fired rule.
 *
 * Called from:
 *  - The tick-worker (apps/web/lib/backfill/tick-worker.ts) right after
 *    promote() succeeds — `trigger: 'sync'`.
 *  - The /api/automation-rules/evaluate-now route — `trigger: 'manual'`.
 *  - The /api/automation-rules POST route (rule creation) — `trigger: 'bootstrap'`,
 *    `ruleIds: [newRule.id]` — snapshots current state without firing.
 *
 * Failures here are caught at the caller boundary (tick-worker wraps in a
 * try/catch) so a buggy rule cannot roll back a promoted backfill.
 */

const RECIPIENT_MODE_VALUES = ['assigned_rep', 'fixed_email'] as const;

const PENDING_TTL_MS = 7 * 24 * 60 * 60 * 1000;

interface EvaluatorJobView {
  id: number;
  customer: string;
  rep: { name: string; email: string | null } | null;
  daysPastTerms: number;
  balance: number;
  heatScore: number;
}

/**
 * Render template strings with a known placeholder vocabulary. Unknown
 * placeholders are left as-is (so a typo doesn't crash the send — the
 * reviewer will spot it).
 */
function renderTemplate(
  template: string,
  ctx: {
    job: EvaluatorJobView;
    rule: { name: string };
    metricName: Metric;
    metricValue: number;
  },
): string {
  return template
    .replace(/\{\{\s*job\.customer\s*\}\}/g, ctx.job.customer)
    .replace(/\{\{\s*job\.balance\s*\}\}/g, formatDollars(ctx.job.balance))
    .replace(/\{\{\s*job\.aging_days\s*\}\}/g, String(ctx.job.daysPastTerms))
    .replace(/\{\{\s*job\.heat_score\s*\}\}/g, String(ctx.job.heatScore))
    .replace(/\{\{\s*rule\.name\s*\}\}/g, ctx.rule.name)
    .replace(/\{\{\s*rep\.name\s*\}\}/g, ctx.job.rep?.name ?? 'the team')
    .replace(/\{\{\s*rep\.email\s*\}\}/g, ctx.job.rep?.email ?? '')
    .replace(/\{\{\s*metric\.name\s*\}\}/g, ctx.metricName.replace('_', ' '))
    .replace(/\{\{\s*metric\.value\s*\}\}/g, formatMetric(ctx.metricName, ctx.metricValue));
}

function formatDollars(n: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(n);
}

function formatMetric(metric: Metric, value: number): string {
  switch (metric) {
    case 'aging_days':
      return `${value} day${value === 1 ? '' : 's'}`;
    case 'balance':
      return formatDollars(value);
    case 'heat_score':
      return String(Math.round(value));
  }
}

function isMetric(s: string): s is Metric {
  return s === 'aging_days' || s === 'balance' || s === 'heat_score';
}

function isOperator(s: string): s is Operator {
  return (
    s === 'crosses_above' ||
    s === 'crosses_below' ||
    s === 'stays_above_for_n_days'
  );
}

export interface EvaluatorResult {
  rulesEvaluated: number;
  firesCreated: number;
  pendingSendsCreated: number;
  pendingSendsSkippedByCap: number;
}

export async function evaluateRulesForTenant(args: {
  tenantId: number;
  trigger: 'sync' | 'manual' | 'bootstrap';
  ruleIds?: number[];
  now?: Date;
}): Promise<EvaluatorResult> {
  const { tenantId, trigger, ruleIds, now: nowArg } = args;
  const now = nowArg ?? new Date();

  // 1. Load enabled rules. Bootstrap can target a specific subset.
  const ruleRows = await db.automationRule.findMany({
    where: {
      tenantId,
      enabled: true,
      ...(ruleIds ? { id: { in: ruleIds } } : {}),
    },
  });

  if (ruleRows.length === 0) {
    return {
      rulesEvaluated: 0,
      firesCreated: 0,
      pendingSendsCreated: 0,
      pendingSendsSkippedByCap: 0,
    };
  }

  // 2. Load the AR working set. getData handles JSON vs DB read paths and
  // applies @vera/domain transforms (heat-score, anomalies, etc.) for us.
  const dataset = await getData(tenantId);
  const jobsForEval: EvaluableJob[] = dataset.jobs.map((j) => ({
    id: j.id,
    daysPastTerms: j.daysPastTerms,
    balance: j.balance,
    heatScore: j.heatScore,
  }));
  const jobIndex = new Map<number, EvaluatorJobView>(
    dataset.jobs.map((j) => [
      j.id,
      {
        id: j.id,
        customer: j.customerName ?? j.fullAddress ?? `Job #${j.id}`,
        rep: j.rep
          ? { name: j.rep.name, email: j.rep.email ?? null }
          : null,
        daysPastTerms: j.daysPastTerms,
        balance: j.balance,
        heatScore: j.heatScore,
      },
    ]),
  );

  // 3. Build rule list for the pure evaluator. Skip any rule with a metric
  // or operator the runtime doesn't recognize — defends against bad data
  // landing in the DB out-of-band.
  const evalRules: EvaluableRule[] = [];
  const ruleById = new Map<number, (typeof ruleRows)[number]>();
  for (const r of ruleRows) {
    if (!isMetric(r.metric) || !isOperator(r.operator)) continue;
    evalRules.push({
      id: r.id,
      metric: r.metric,
      operator: r.operator,
      threshold: r.threshold,
      thresholdDays: r.thresholdDays ?? null,
    });
    ruleById.set(r.id, r);
  }

  // 4. Load prior states for the (rule, job) pairs we're about to evaluate.
  const jobIds = jobsForEval.map((j) => j.id);
  const stateRows =
    jobIds.length === 0 || evalRules.length === 0
      ? []
      : await db.ruleEvaluationState.findMany({
          where: {
            ruleId: { in: evalRules.map((r) => r.id) },
            jobId: { in: jobIds },
          },
        });
  const priorStates: PriorState[] = stateRows.map((s) => ({
    ruleId: s.ruleId,
    jobId: s.jobId,
    wasAboveThreshold: s.wasAboveThreshold,
    streakStartedAt: s.streakStartedAt,
    lastFiredAt: s.lastFiredAt,
  }));

  // 5. Pure evaluation.
  const result = evaluateAutomationRules({
    rules: evalRules,
    jobs: jobsForEval,
    priorStates,
    now,
    bootstrap: trigger === 'bootstrap',
  });

  // 6. Compute per-rule cap usage *before* writing new pending rows. We count
  // rows from the last 24h whose status hasn't been resolved as rejected /
  // expired — pending + missing_recipient + approved + sent + pending_send_failed
  // all count against the cap.
  const since24h = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const capCountsRaw =
    result.fires.length === 0
      ? []
      : await db.pendingRuleSend.groupBy({
          by: ['ruleId'],
          where: {
            tenantId,
            ruleId: { in: Array.from(new Set(result.fires.map((f) => f.ruleId))) },
            createdAt: { gte: since24h },
            status: {
              in: [
                'pending',
                'missing_recipient',
                'approved',
                'sent',
                'pending_send_failed',
              ],
            },
          },
          _count: { _all: true },
        });
  const capUsage = new Map<number, number>(
    capCountsRaw.map((row) => [row.ruleId, row._count._all]),
  );

  // 7. Persist new states + pending sends + audit rows. One transaction so
  // a mid-write crash doesn't leave stranded baseline updates.
  let firesCreated = 0;
  let pendingSendsCreated = 0;
  let pendingSendsSkippedByCap = 0;

  // Track per-rule fire summary for audit rows.
  const firesByRule = new Map<number, RuleFire[]>();
  const skippedByRule = new Map<number, number>();

  await db.$transaction(async (tx) => {
    // Upsert states. RuleEvaluationState has a unique (ruleId, jobId), so
    // upsert is idempotent.
    for (const s of result.newStates) {
      await tx.ruleEvaluationState.upsert({
        where: { ruleId_jobId: { ruleId: s.ruleId, jobId: s.jobId } },
        create: {
          ruleId: s.ruleId,
          jobId: s.jobId,
          lastMetricValue: s.lastMetricValue,
          wasAboveThreshold: s.wasAboveThreshold,
          streakStartedAt: s.streakStartedAt,
          lastFiredAt: s.lastFiredAt,
          lastEvaluatedAt: now,
        },
        update: {
          lastMetricValue: s.lastMetricValue,
          wasAboveThreshold: s.wasAboveThreshold,
          streakStartedAt: s.streakStartedAt,
          lastFiredAt: s.lastFiredAt,
          lastEvaluatedAt: now,
        },
      });
    }

    // Pending sends for each fire, subject to the per-rule cap.
    for (const fire of result.fires) {
      const rule = ruleById.get(fire.ruleId);
      const job = jobIndex.get(fire.jobId);
      if (!rule || !job) continue;

      const used = capUsage.get(rule.id) ?? 0;
      if (used >= rule.dailySendCap) {
        pendingSendsSkippedByCap += 1;
        skippedByRule.set(rule.id, (skippedByRule.get(rule.id) ?? 0) + 1);
        continue;
      }
      capUsage.set(rule.id, used + 1);

      const proposedRecipient =
        rule.recipientMode === 'fixed_email'
          ? rule.recipientEmail ?? null
          : job.rep?.email ?? null;

      const status =
        rule.recipientMode === 'assigned_rep' && !proposedRecipient
          ? 'missing_recipient'
          : 'pending';

      const templateCtx = {
        job,
        rule: { name: rule.name },
        metricName: rule.metric as Metric,
        metricValue: fire.metricValueAtFire,
      };

      await tx.pendingRuleSend.create({
        data: {
          tenantId,
          ruleId: rule.id,
          jobId: job.id,
          triggerSnapshot: {
            metric: rule.metric,
            operator: rule.operator,
            threshold: rule.threshold,
            thresholdDays: rule.thresholdDays,
            metricValueAtFire: fire.metricValueAtFire,
            reason: fire.reason,
            jobSnapshot: {
              customer: job.customer,
              balance: job.balance,
              daysPastTerms: job.daysPastTerms,
              heatScore: job.heatScore,
              rep: job.rep,
            },
          },
          proposedRecipient,
          proposedSubject: renderTemplate(rule.subjectTemplate, templateCtx),
          proposedBody: renderTemplate(rule.bodyTemplate, templateCtx),
          status,
          expiresAt: new Date(now.getTime() + PENDING_TTL_MS),
        },
      });

      firesCreated += 1;
      pendingSendsCreated += 1;
      const list = firesByRule.get(rule.id) ?? [];
      list.push(fire);
      firesByRule.set(rule.id, list);
    }

    // Stamp lastEvaluatedAt on every rule that participated, even ones with
    // zero fires — so the "last evaluated" badge on the rule card stays
    // truthful.
    await tx.automationRule.updateMany({
      where: { id: { in: ruleRows.map((r) => r.id) } },
      data: { lastEvaluatedAt: now },
    });

    // Audit row per rule that actually did something on this run (fired or
    // skipped some pending rows due to the cap). Silent rules don't create
    // noise in the audit log.
    for (const rule of ruleRows) {
      const fired = firesByRule.get(rule.id) ?? [];
      const skipped = skippedByRule.get(rule.id) ?? 0;
      if (fired.length === 0 && skipped === 0) continue;
      const summary =
        fired.length > 0
          ? `Rule "${rule.name}" fired on ${fired.length} job${fired.length === 1 ? '' : 's'}` +
            (skipped > 0 ? ` (${skipped} skipped by daily cap)` : '')
          : `Rule "${rule.name}" hit its daily cap — ${skipped} job${skipped === 1 ? '' : 's'} skipped`;
      await recordAudit(tx, {
        tenantId,
        category: 'automation_rules',
        action: 'evaluated',
        entityType: 'AutomationRule',
        entityId: String(rule.id),
        summary,
        details: {
          ruleId: rule.id,
          trigger,
          firedJobIds: fired.map((f) => f.jobId),
          skippedByCap: skipped,
        },
      });
    }
  });

  return {
    rulesEvaluated: ruleRows.length,
    firesCreated,
    pendingSendsCreated,
    pendingSendsSkippedByCap,
  };
}

export { RECIPIENT_MODE_VALUES };
