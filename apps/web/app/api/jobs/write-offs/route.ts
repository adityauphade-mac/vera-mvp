import { z } from 'zod';
import { getWriteOffs } from '@/lib/write-offs-data';
import { jsonResponse, parseQuery } from '@/lib/api-helpers';

const QuerySchema = z.object({
  rep: z.string().optional(),
  region: z.string().optional(),
});

export async function GET(req: Request) {
  const url = new URL(req.url);
  const parsed = parseQuery(QuerySchema, url);
  if ('__error' in parsed) return parsed.__error;

  const file = getWriteOffs();
  let filtered = file.records;
  if (parsed.rep) filtered = filtered.filter((r) => r.repName === parsed.rep);
  if (parsed.region) filtered = filtered.filter((r) => r.region === parsed.region);

  const totalAmountWithheld = filtered.reduce((s, r) => s + r.amountWithheld, 0);
  const largest = filtered.reduce((m, r) => Math.max(m, r.amountWithheld), 0);
  const average = filtered.length === 0 ? 0 : totalAmountWithheld / filtered.length;

  return jsonResponse({
    generatedAt: file.generatedAt,
    scope: file.scope,
    totals: {
      ...file.totals,
      filteredCount: filtered.length,
      filteredTotalAmountWithheld: totalAmountWithheld,
      filteredAverageAmountWithheld: average,
      filteredLargestAmountWithheld: largest,
    },
    records: filtered,
  });
}
