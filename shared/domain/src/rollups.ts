import type { ARJob, RepRollup } from '@vera/types';

export function repRollups(jobs: ARJob[]): RepRollup[] {
  const byRepId = new Map<number, RepRollup>();

  for (const job of jobs) {
    if (!job.rep) continue;
    const key = job.rep.id;
    let entry = byRepId.get(key);
    if (!entry) {
      entry = {
        rep: job.rep,
        jobCount: 0,
        totalOutstanding: 0,
        oldestDaysPastTerms: 0,
        averageHeatScore: 0,
        hotJobs: 0,
        criticalJobs: 0,
      };
      byRepId.set(key, entry);
    }
    entry.jobCount += 1;
    entry.totalOutstanding += job.balance;
    entry.oldestDaysPastTerms = Math.max(entry.oldestDaysPastTerms, job.daysPastTerms);
    entry.averageHeatScore += job.heatScore;
    if (job.heatBand === 'hot') entry.hotJobs += 1;
    if (job.heatBand === 'critical') entry.criticalJobs += 1;
  }

  for (const r of byRepId.values()) {
    r.averageHeatScore = r.jobCount === 0 ? 0 : Math.round(r.averageHeatScore / r.jobCount);
  }

  return [...byRepId.values()].sort((a, b) => b.totalOutstanding - a.totalOutstanding);
}
