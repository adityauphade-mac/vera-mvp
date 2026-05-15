import { NextResponse } from 'next/server';
import {
  evaluateAutomationRules,
  type EvaluableJob,
  type Metric,
  type Operator,
} from '@vera/domain';
import { db } from '@/lib/db';
import { getData } from '@/lib/data';
import { withAuth } from '@/lib/auth-helpers';

export const runtime = 'nodejs';

type RouteContext = { params: Promise<{ id: string }> };

/**
 * POST /api/automation-rules/[id]/preview
 *
 * Dry-run an existing rule against the current AR working set. Returns the
 * list of jobs that currently match (i.e., the metric is at or above the
 * threshold). Does NOT fire — no PendingRuleSend rows, no state writes, no
 * audit row.
 *
 * Used by the rule-builder UI to show "if this rule existed now, it would
 * match N jobs" before the user commits a change. Catches threshold mistakes
 * before they generate noise in the queue.
 */
export async function POST(_req: Request, ctx: RouteContext) {
  return withAuth(async (audit) => {
    const { id: idRaw } = await ctx.params;
    const id = Number(idRaw);
    if (!Number.isInteger(id) || id <= 0) {
      return NextResponse.json({ error: 'invalid_id' }, { status: 400 });
    }
    const rule = await db.automationRule.findFirst({
      where: { id, tenantId: audit.tenantId },
    });
    if (!rule) {
      return NextResponse.json({ error: 'not_found' }, { status: 404 });
    }

    const dataset = await getData(audit.tenantId);
    const jobs: EvaluableJob[] = dataset.jobs.map((j) => ({
      id: j.id,
      daysPastTerms: j.daysPastTerms,
      balance: j.balance,
      heatScore: j.heatScore,
    }));

    // Synthetic "all jobs start below threshold" prior so crosses_above
    // returns everyone currently above. Bootstrap-style: this is a snapshot,
    // not an event detector.
    const priorStates = jobs.map((j) => ({
      ruleId: rule.id,
      jobId: j.id,
      wasAboveThreshold: false,
      streakStartedAt: null as Date | null,
      lastFiredAt: null as Date | null,
    }));

    const result = evaluateAutomationRules({
      rules: [
        {
          id: rule.id,
          metric: rule.metric as Metric,
          operator: rule.operator as Operator,
          threshold: rule.threshold,
          thresholdDays: rule.thresholdDays ?? null,
        },
      ],
      jobs,
      priorStates,
      now: new Date(),
    });

    // For preview we surface "jobs currently above threshold" rather than
    // "fired" — fires depends on the operator's transition semantics and
    // the synthetic prior. For crosses_above, currently-above-with-synthetic-
    // below-prior is the same set as fired. For stays_above_for_n_days, the
    // preview reports the *potential* set instead of waiting N days. The UI
    // labels this accordingly.
    const matchedJobIds = new Set<number>();
    for (const j of jobs) {
      const metricValue =
        rule.metric === 'aging_days'
          ? j.daysPastTerms
          : rule.metric === 'balance'
            ? j.balance
            : j.heatScore;
      if (metricValue >= rule.threshold) matchedJobIds.add(j.id);
    }

    const matchedJobs = dataset.jobs
      .filter((j) => matchedJobIds.has(j.id))
      .slice(0, 25)
      .map((j) => ({
        id: j.id,
        customer: j.customerName ?? j.fullAddress ?? `Job #${j.id}`,
        address: j.fullAddress,
        balance: j.balance,
        daysPastTerms: j.daysPastTerms,
        heatScore: j.heatScore,
        repName: j.rep?.name ?? null,
        repEmail: j.rep?.email ?? null,
      }));

    return NextResponse.json({
      matchedCount: matchedJobIds.size,
      // Show what evaluateAutomationRules thinks — useful for verifying
      // the operator's transition semantics in tests.
      pureEvaluatorFires: result.fires.length,
      preview: matchedJobs,
    });
  });
}
