/**
 * Pure evaluator for automation rules.
 *
 * Takes the current AR working set + per-(rule, job) baselines + `now` and
 * returns the new baselines + the list of fires. Zero side effects: no DB,
 * no fetch, no clock — `now` is a parameter. The DB-side wrapper at
 * apps/web/lib/automation/evaluator.ts is what loads inputs, persists outputs,
 * and creates PendingRuleSend rows.
 *
 * Operator semantics (decided in DISCUSSION.md §7):
 *   - crosses_above:        was below threshold, now ≥ threshold → fires once.
 *   - crosses_below:        was ≥ threshold, now below → fires once.
 *   - stays_above_for_n_days: has been ≥ threshold continuously for at least
 *                            `thresholdDays`; once fired, won't re-fire on the
 *                            same streak until another `thresholdDays` elapses.
 *
 * Bootstrap mode (`bootstrap: true`): used when a rule is first created. We
 * record the current observation as the baseline for every job WITHOUT
 * emitting fires. This is what stops "create a heat>50 rule → 100 pending
 * sends instantly" from happening.
 */

export type Metric = 'aging_days' | 'balance' | 'heat_score';
export type Operator =
  | 'crosses_above'
  | 'crosses_below'
  | 'stays_above_for_n_days';

export interface EvaluableRule {
  id: number;
  metric: Metric;
  operator: Operator;
  threshold: number;
  /** Only used when operator = 'stays_above_for_n_days'. Defaults to 7 if null. */
  thresholdDays: number | null;
}

export interface EvaluableJob {
  id: number;
  daysPastTerms: number;
  balance: number;
  heatScore: number;
}

export interface PriorState {
  ruleId: number;
  jobId: number;
  wasAboveThreshold: boolean;
  streakStartedAt: Date | null;
  lastFiredAt: Date | null;
}

export type FireReason =
  | 'crossed_above'
  | 'crossed_below'
  | 'stayed_above_for_days';

export interface RuleFire {
  ruleId: number;
  jobId: number;
  metricValueAtFire: number;
  reason: FireReason;
}

export interface NewState {
  ruleId: number;
  jobId: number;
  lastMetricValue: number;
  wasAboveThreshold: boolean;
  streakStartedAt: Date | null;
  lastFiredAt: Date | null;
}

export interface EvaluationResult {
  fires: RuleFire[];
  newStates: NewState[];
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;

function readMetric(job: EvaluableJob, metric: Metric): number {
  switch (metric) {
    case 'aging_days':
      return job.daysPastTerms;
    case 'balance':
      return job.balance;
    case 'heat_score':
      return job.heatScore;
  }
}

function daysBetween(a: Date, b: Date): number {
  return (a.getTime() - b.getTime()) / MS_PER_DAY;
}

export function evaluateAutomationRules(args: {
  rules: readonly EvaluableRule[];
  jobs: readonly EvaluableJob[];
  priorStates: readonly PriorState[];
  now: Date;
  bootstrap?: boolean;
}): EvaluationResult {
  const { rules, jobs, priorStates, now, bootstrap = false } = args;

  const priorByKey = new Map<string, PriorState>();
  for (const s of priorStates) {
    priorByKey.set(`${s.ruleId}:${s.jobId}`, s);
  }

  const fires: RuleFire[] = [];
  const newStates: NewState[] = [];

  for (const rule of rules) {
    for (const job of jobs) {
      const metricValue = readMetric(job, rule.metric);
      const currentlyAbove = metricValue >= rule.threshold;

      const prior = priorByKey.get(`${rule.id}:${job.id}`) ?? {
        ruleId: rule.id,
        jobId: job.id,
        wasAboveThreshold: false,
        streakStartedAt: null,
        lastFiredAt: null,
      };

      let nextStreakStartedAt: Date | null = prior.streakStartedAt;
      let nextLastFiredAt: Date | null = prior.lastFiredAt;
      let fired = false;
      let fireReason: FireReason | null = null;

      // Update streak state for any operator. Entering "above" starts a
      // streak; leaving "above" clears it; staying preserves whatever was
      // there. The decision to fire happens below per operator.
      if (currentlyAbove && !prior.wasAboveThreshold) {
        nextStreakStartedAt = now;
      } else if (!currentlyAbove && prior.wasAboveThreshold) {
        nextStreakStartedAt = null;
      }

      if (!bootstrap) {
        if (rule.operator === 'crosses_above') {
          if (currentlyAbove && !prior.wasAboveThreshold) {
            fired = true;
            fireReason = 'crossed_above';
          }
        } else if (rule.operator === 'crosses_below') {
          if (!currentlyAbove && prior.wasAboveThreshold) {
            fired = true;
            fireReason = 'crossed_below';
          }
        } else if (rule.operator === 'stays_above_for_n_days') {
          const window = rule.thresholdDays ?? 7;
          if (currentlyAbove && nextStreakStartedAt !== null) {
            const elapsed = daysBetween(now, nextStreakStartedAt);
            const sinceLastFire =
              prior.lastFiredAt === null
                ? Number.POSITIVE_INFINITY
                : daysBetween(now, prior.lastFiredAt);
            if (elapsed >= window && sinceLastFire >= window) {
              fired = true;
              fireReason = 'stayed_above_for_days';
            }
          }
        }
      }

      if (fired) {
        nextLastFiredAt = now;
        fires.push({
          ruleId: rule.id,
          jobId: job.id,
          metricValueAtFire: metricValue,
          reason: fireReason ?? 'crossed_above',
        });
      }

      newStates.push({
        ruleId: rule.id,
        jobId: job.id,
        lastMetricValue: metricValue,
        wasAboveThreshold: currentlyAbove,
        streakStartedAt: nextStreakStartedAt,
        lastFiredAt: nextLastFiredAt,
      });
    }
  }

  return { fires, newStates };
}
