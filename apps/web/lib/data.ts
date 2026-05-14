import 'server-only';
import {
  GeneratedDataSchema,
  RoofLinkJobSchema,
  type GeneratedData,
  type RoofLinkJob,
} from '@vera/types';
import { repRollups, toARJob } from '@vera/domain';
import generatedJson from '@/data/generated.json';
import { getLiveARJobsWithContext, promotedVersionIds } from './backfill/merge-view';
import { auth } from './auth';

/**
 * Source-of-truth for the metrics dashboard. Two paths:
 *
 *   - **JSON path** (default) — parse the build-time `generated.json` snapshot.
 *     Same behavior the dashboard has shipped with since day one. Tenant-
 *     agnostic; the snapshot represents the single demo tenant.
 *
 *   - **DB path** (`USE_DB_DATA_SOURCE=1`) — read the latest promoted
 *     RawRooflinkJob rows for `tenantId` via `getLiveJobs`, run the same
 *     domain transform the preprocess uses (`toARJob`), and return the same
 *     `GeneratedData` shape. Cached per-`(tenantId, promotedRunIds)` so a
 *     promote bust naturally invalidates the cache.
 *
 * Routes call `await getData(tenantId)`. The dispatcher picks the path.
 * Once the cutover is verified in prod, the JSON path and the flag will be
 * removed in a follow-up.
 */

// ---------------------------------------------------------------------------
// JSON path — unchanged behavior; the snapshot is bundled at build time.
// ---------------------------------------------------------------------------

let jsonCache: GeneratedData | null = null;

function getDataFromJson(): GeneratedData {
  if (jsonCache) return jsonCache;
  jsonCache = GeneratedDataSchema.parse(generatedJson);
  return jsonCache;
}

// ---------------------------------------------------------------------------
// DB path — request-time read with per-(tenant, promoted-run-ids) cache.
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
 * Drop any cached DB snapshot for a tenant. Called by the backfill tick
 * worker right after a successful promote so the next request recomputes
 * from fresh DB rows. No-op for the JSON path.
 */
export function invalidateDataSnapshot(tenantId: number): void {
  dbCache.delete(tenantId);
}

// ---------------------------------------------------------------------------
// Dispatcher — every route calls `await getData(tenantId)`.
// ---------------------------------------------------------------------------

function isDbPathEnabled(): boolean {
  return process.env.USE_DB_DATA_SOURCE === '1';
}

export async function getData(tenantId: number): Promise<GeneratedData> {
  if (isDbPathEnabled()) return getDataFromDb(tenantId);
  return getDataFromJson();
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
