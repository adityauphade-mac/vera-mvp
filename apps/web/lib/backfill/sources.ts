import 'server-only';

/**
 * Registry of backfill sources. Both UI and worker import from here so the
 * set of valid source identifiers is defined in exactly one place. See
 * docs/BACKFILL_SCHEDULING.md §3 for the broader design.
 */

export const BACKFILL_SOURCES = ['rooflink_jobs', 'rooflink_lineitems'] as const;
export type BackfillSource = (typeof BACKFILL_SOURCES)[number];

export function isBackfillSource(v: string): v is BackfillSource {
  return (BACKFILL_SOURCES as readonly string[]).includes(v);
}

export interface BackfillSourceMeta {
  id: BackfillSource;
  title: string;
  description: string;
  /** Approx total record count — surfaced in the UI and used for ETA math. */
  approxItemsTotal: number;
  /** Rooflink rate-limited batch size that fits in a 60s Hobby function. */
  batchSize: number;
}

export const BACKFILL_META: Record<BackfillSource, BackfillSourceMeta> = {
  rooflink_jobs: {
    id: 'rooflink_jobs',
    title: 'Rooflink jobs',
    description:
      'Bulk list of every job (rollup totals only — gt_price, payments, profit).',
    approxItemsTotal: 103_440,
    // /jobs/ paginated 100 jobs/page. Smaller batch = more frequent UI
    // updates. 2 pages × ~10s under WAF throttle = ~20s per tick, well
    // under the 60s Hobby cap and visibly progressing.
    batchSize: 2,
  },
  rooflink_lineitems: {
    id: 'rooflink_lineitems',
    title: 'Rooflink line items',
    description:
      'Per-estimate breakdown — RCV, depreciation, withheld, supplements, change orders.',
    approxItemsTotal: 8_492,
    // 1 request per estimate. Smaller batch keeps the UI feeling alive.
    batchSize: 2,
  },
};
