import { differenceInCalendarDays } from 'date-fns';
import type { HeatBand, HeatBreakdown, RoofLinkJob } from '@vera/types';
import { daysPastTerms } from './aging';

/** Days since the record was last touched in any way (custom step, edit, etc.). */
function daysSinceLastActivity(job: RoofLinkJob, now: Date): number {
  let mostRecent: Date | null = null;
  if (job.date_last_edited) mostRecent = new Date(job.date_last_edited);

  const steps = job.custom_steps ?? {};
  for (const step of Object.values(steps)) {
    if (step?.date_completed) {
      const d = new Date(step.date_completed);
      if (!mostRecent || d > mostRecent) mostRecent = d;
    }
  }
  if (!mostRecent) return 999;
  return Math.max(0, differenceInCalendarDays(now, mostRecent));
}

/** Q7: 0–100 heat score with 4 transparent components. */
export function computeHeatScore(
  job: RoofLinkJob,
  context: { now: Date; anomalyCount: number },
): { score: number; band: HeatBand; breakdown: HeatBreakdown } {
  // Days past terms — 40 points, capped at 60+ days.
  const past = daysPastTerms(job, context.now);
  const daysComponent = Math.min(past / 60, 1) * 40;

  // Balance — 25 points, log-scaled. $1k≈30%, $10k≈70%, $50k≈100%.
  const balance = Math.max(0, job.primary_estimate?.balance ?? 0);
  const dollarRatio = balance > 0 ? Math.min(Math.log10(balance + 1) / Math.log10(50_000), 1) : 0;
  const dollarComponent = dollarRatio * 25;

  // Rep silence — 20 points. 0 if active in last 14 days, 100% at 30+ days quiet.
  const silenceDays = daysSinceLastActivity(job, context.now);
  let silenceFactor = 0;
  if (silenceDays > 14) {
    silenceFactor = Math.min((silenceDays - 14) / 16, 1); // 14→0, 30→1
  }
  const silenceComponent = silenceFactor * 20;

  // Anomalies — 15 points. Each anomaly adds 33%, capped at 3.
  const anomalyComponent = (Math.min(context.anomalyCount, 3) / 3) * 15;

  const score = Math.round(daysComponent + dollarComponent + silenceComponent + anomalyComponent);

  let band: HeatBand;
  if (score <= 25) band = 'cool';
  else if (score <= 50) band = 'warm';
  else if (score <= 75) band = 'hot';
  else band = 'critical';

  return {
    score,
    band,
    breakdown: {
      daysComponent: Math.round(daysComponent),
      dollarComponent: Math.round(dollarComponent),
      silenceComponent: Math.round(silenceComponent),
      anomalyComponent: Math.round(anomalyComponent),
    },
  };
}

export function daysSinceLastEdit(job: RoofLinkJob, now: Date): number {
  return daysSinceLastActivity(job, now);
}
