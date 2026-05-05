import { z } from 'zod';
import { HeatBandSchema } from '@vera/types';
import { getData } from '@/lib/data';
import { jsonResponse, parseQuery } from '@/lib/api-helpers';

const QuerySchema = z.object({
  band: HeatBandSchema.optional(),
  rep: z.string().optional(),
});

export async function GET(req: Request) {
  const url = new URL(req.url);
  const parsed = parseQuery(QuerySchema, url);
  if ('__error' in parsed) return parsed.__error;

  const { jobs, asOf } = getData();
  let filtered = jobs;
  if (parsed.band) filtered = filtered.filter((j) => j.heatBand === parsed.band);
  if (parsed.rep) filtered = filtered.filter((j) => j.rep?.id?.toString() === parsed.rep);

  const sorted = [...filtered].sort((a, b) => b.heatScore - a.heatScore);

  const followUps = sorted.filter((j) => j.heatBand === 'hot');
  const executiveQueue = sorted.filter((j) => j.heatBand === 'critical');

  return jsonResponse({
    asOf,
    totalCount: sorted.length,
    followUps,
    executiveQueue,
    jobs: sorted,
  });
}
