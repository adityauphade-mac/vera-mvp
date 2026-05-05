import { z } from 'zod';
import type { RepRollup } from '@vera/types';
import { getData } from '@/lib/data';
import { jsonResponse, parseQuery } from '@/lib/api-helpers';

const SortSchema = z.enum(['dollars', 'count', 'oldest', 'heat']);
const QuerySchema = z.object({
  sort: SortSchema.optional(),
  region: z.string().optional(),
  jobType: z.string().optional(),
});

export async function GET(req: Request) {
  const url = new URL(req.url);
  const parsed = parseQuery(QuerySchema, url);
  if ('__error' in parsed) return parsed.__error;

  const { reps, jobs, asOf } = getData();

  // If region/jobType filters are present, we need to recompute rollups from filtered jobs.
  let rollups: RepRollup[] = reps;
  if (parsed.region || parsed.jobType) {
    const filtered = jobs.filter((j) => {
      if (parsed.region && j.region !== parsed.region) return false;
      if (parsed.jobType && j.jobType !== parsed.jobType) return false;
      return true;
    });
    const byRep = new Map<number, RepRollup>();
    for (const j of filtered) {
      if (!j.rep) continue;
      let entry = byRep.get(j.rep.id);
      if (!entry) {
        entry = {
          rep: j.rep,
          jobCount: 0,
          totalOutstanding: 0,
          oldestDaysPastTerms: 0,
          averageHeatScore: 0,
          hotJobs: 0,
          criticalJobs: 0,
        };
        byRep.set(j.rep.id, entry);
      }
      entry.jobCount += 1;
      entry.totalOutstanding += j.balance;
      entry.oldestDaysPastTerms = Math.max(entry.oldestDaysPastTerms, j.daysPastTerms);
      entry.averageHeatScore += j.heatScore;
      if (j.heatBand === 'hot') entry.hotJobs += 1;
      if (j.heatBand === 'critical') entry.criticalJobs += 1;
    }
    rollups = [...byRep.values()].map((r) => ({
      ...r,
      averageHeatScore: r.jobCount === 0 ? 0 : Math.round(r.averageHeatScore / r.jobCount),
    }));
  }

  const sort = parsed.sort ?? 'dollars';
  const sorted = [...rollups].sort((a, b) => {
    if (sort === 'dollars') return b.totalOutstanding - a.totalOutstanding;
    if (sort === 'count') return b.jobCount - a.jobCount;
    if (sort === 'oldest') return b.oldestDaysPastTerms - a.oldestDaysPastTerms;
    return b.averageHeatScore - a.averageHeatScore;
  });

  return jsonResponse({
    asOf,
    totalReps: sorted.length,
    totalAR: sorted.reduce((s, r) => s + r.totalOutstanding, 0),
    reps: sorted,
  });
}
