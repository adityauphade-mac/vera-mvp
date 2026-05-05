import { z } from 'zod';
import { AgingBucketSchema, type ARJob } from '@vera/types';
import { getData } from '@/lib/data';
import { jsonResponse, parseQuery } from '@/lib/api-helpers';

const QuerySchema = z.object({
  bucket: AgingBucketSchema.optional(),
  rep: z.string().optional(),
  region: z.string().optional(),
  jobType: z.string().optional(),
});

export async function GET(req: Request) {
  const url = new URL(req.url);
  const parsed = parseQuery(QuerySchema, url);
  if ('__error' in parsed) return parsed.__error;

  const { jobs, asOf } = getData();
  let filtered: ARJob[] = jobs;

  if (parsed.bucket) filtered = filtered.filter((j) => j.agingBucket === parsed.bucket);
  if (parsed.rep) filtered = filtered.filter((j) => j.rep?.id?.toString() === parsed.rep);
  if (parsed.region) filtered = filtered.filter((j) => j.region === parsed.region);
  if (parsed.jobType) filtered = filtered.filter((j) => j.jobType === parsed.jobType);

  const buckets: Record<string, { count: number; total: number }> = {
    'within-terms': { count: 0, total: 0 },
    '1-30-past': { count: 0, total: 0 },
    '31-60-past': { count: 0, total: 0 },
    '60-plus-past': { count: 0, total: 0 },
  };
  for (const j of jobs) {
    const b = buckets[j.agingBucket];
    if (b) {
      b.count += 1;
      b.total += j.balance;
    }
  }

  // Anomaly groupings — flag → array of jobs
  const byAnomaly: Record<string, number> = {};
  for (const j of jobs) {
    for (const a of j.anomalies) byAnomaly[a] = (byAnomaly[a] ?? 0) + 1;
  }

  return jsonResponse({
    asOf,
    totalCount: filtered.length,
    totalBalance: filtered.reduce((s, j) => s + j.balance, 0),
    jobs: filtered,
    bucketSummary: buckets,
    anomalySummary: byAnomaly,
  });
}
