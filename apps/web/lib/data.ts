import 'server-only';
import {
  GeneratedDataSchema,
  RoofLinkJobSchema,
  type GeneratedData,
  type RoofLinkJob,
} from '@vera/types';
import { repRollups, toARJob } from '@vera/domain';
import { getLiveARJobsWithContext, promotedVersionIds } from './backfill/merge-view';
import { auth } from './auth';

/**
 * Source-of-truth for the metrics dashboard.
 *
 * Reads the latest promoted rooflink_jobs snapshot from Postgres for
 * `tenantId` via `getLiveARJobsWithContext`, runs the same domain
 * transform the original preprocess pipeline used (`toARJob`), and
 * returns the same `GeneratedData` shape the UI has consumed since
 * day one. Result is cached per-(tenantId, promoted-run-ids) so any
 * promote (full or incremental) naturally invalidates the slot.
 *
 * History: until 2026-05-18 there was a parallel JSON path that read a
 * build-time `apps/web/data/generated.json` snapshot, gated by
 * `USE_DB_DATA_SOURCE`. The flag is gone and the DB path is the only
 * read path now. See docs/JSON_REMOVAL_PLAN.md for the removal arc.
 */

// ---------------------------------------------------------------------------
// DB read — request-time, per-(tenant, promoted-run-ids) cache.
// ---------------------------------------------------------------------------

interface DbCacheSlot {
  /** Stable string derived from the promoted-run-ids list for this tenant. */
  versionKey: string;
  data: GeneratedData;
}

const dbCache = new Map<number, DbCacheSlot>();

/**
 * Read the latest promoted rooflink_jobs snapshot from the DB and project it
 * into `GeneratedData`. The heavy lifting that used to happen in Node —
 * filtering 120k jobs down to ~130 AR-eligible ones, and counting addresses
 * across the full population for the duplicate-address anomaly — both now
 * happen in Postgres via `getLiveARJobsWithContext`. Node only receives the
 * AR working set (~130 rows) plus a per-job `addressCount`, dropping the
 * cold-miss transfer from ~200 MB to ~650 KB.
 *
 * Cached per tenant; cache key is the concatenated promoted-run-id list so
 * any promote (full or incremental) naturally invalidates the slot.
 */
async function getDataFromDb(tenantId: number): Promise<GeneratedData> {
  // CHEAP cache-key probe first: pull just the promoted-run-id list (a
  // small `SELECT id FROM BackfillRun WHERE promoted=true` — milliseconds)
  // and compare against the cached version before any heavy fetch.
  const promotedIds = await promotedVersionIds(tenantId, 'rooflink_jobs');
  const versionKey = promotedIds.join(',');

  const cached = dbCache.get(tenantId);
  if (cached && cached.versionKey === versionKey) return cached.data;

  // Cache miss — do the (now much smaller) fetch.
  const rawRows = await getLiveARJobsWithContext(tenantId);
  const now = new Date();

  // Reconstruct the addressCounts map from the per-row counts the SQL
  // computed. Rows whose `addressCount` is 1 don't need to be in the map
  // (the domain transform treats absence-or-1 as "not duplicated"), but
  // including them is harmless and keeps the lookup simple.
  const addressCounts = new Map<string, number>();
  const parsedJobs: { job: RoofLinkJob; addressCount: number }[] = [];
  for (const row of rawRows) {
    const parsed = RoofLinkJobSchema.safeParse(row.payload);
    if (!parsed.success) continue;
    const job = parsed.data;
    parsedJobs.push({ job, addressCount: row.addressCount });
    const addr = (job.full_address ?? job.address ?? '').trim().toLowerCase();
    if (addr && row.addressCount > 1) addressCounts.set(addr, row.addressCount);
  }

  // SQL has already applied the AR working-set filter, so no in-Node filter
  // step here — every row is AR-eligible by construction.
  const arJobs = parsedJobs.map(({ job }) => toARJob(job, { addressCounts, now }));

  const totalAR = arJobs.reduce((sum, j) => sum + j.balance, 0);
  const reps = repRollups(arJobs);

  const data: GeneratedData = GeneratedDataSchema.parse({
    generatedAt: new Date().toISOString(),
    asOf: now.toISOString(),
    jobCount: arJobs.length,
    totalAR,
    jobs: arJobs,
    reps,
  });

  dbCache.set(tenantId, { versionKey, data });
  return data;
}

/**
 * Drop any cached snapshot for a tenant. Called by the backfill tick
 * worker right after a successful promote so the next request recomputes
 * from fresh DB rows.
 */
export function invalidateDataSnapshot(tenantId: number): void {
  dbCache.delete(tenantId);
}

// ---------------------------------------------------------------------------
// Public entry points.
// ---------------------------------------------------------------------------

export async function getData(tenantId: number): Promise<GeneratedData> {
  return getDataFromDb(tenantId);
}

/**
 * Session-aware variant for dashboard server components. Middleware already
 * gates `/dashboard/*` behind auth, so by the time this runs we're guaranteed
 * a session — the throw is defense-in-depth, not a UX path. API routes
 * should NOT use this; they use `withAuth(...)` + `getData(tenantId)` so the
 * audit context is set in the same scope.
 */
export async function getDataForCurrentSession(): Promise<GeneratedData> {
  const session = await auth();
  const tenantId = session?.user?.tenantId;
  if (typeof tenantId !== 'number') {
    throw new Error(
      '[lib/data] getDataForCurrentSession called without a tenant-bound session — ' +
        'check middleware coverage for this route.',
    );
  }
  return getData(tenantId);
}
