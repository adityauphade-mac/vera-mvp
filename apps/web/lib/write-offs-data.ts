import 'server-only';
import {
  RoofLinkJobSchema,
  WriteOffsFileSchema,
  type RoofLinkJob,
  type WriteOffRecord,
  type WriteOffsFile,
} from '@vera/types';
import { toWriteOffRecord } from '@vera/domain';
import {
  getLiveJobsForWriteOffs,
  getLiveLineItems,
  promotedVersionIds,
} from './backfill/merge-view';
import { auth } from './auth';

/**
 * Source-of-truth for the Write-offs dashboard.
 *
 * Joins the latest promoted RawRooflinkJob rows against the promoted
 * RawRooflinkLineItems rows for the same tenant, runs `toWriteOffRecord`
 * from `@vera/domain` to keep detection logic in one place, drops records
 * with an install date before `INSTALL_DATE_CUTOFF`, and aggregates totals
 * at request time. Cached per `(tenantId, jobs-version, lineitems-version)`.
 *
 * Scope: `all-estimates` (no AR working-set filter), 2024-01-01
 * install-date cutoff — per the May 13 product decision (see
 * `docs/RELEASE.md` "2026-05-13 — Write-offs broadened").
 *
 * History: until 2026-05-18 there was a parallel JSON path that parsed a
 * build-time `apps/web/data/write-offs.json` snapshot, gated by
 * `USE_DB_DATA_SOURCE`. The flag is gone and the DB path is the only
 * read path now. See docs/JSON_REMOVAL_PLAN.md.
 */

/**
 * Only include jobs whose install (date_completed) is on or after this
 * date. Historical pre-2024 write-offs are noise — the team only acts on
 * recent installs. Null install dates (jobs not yet completed) are also
 * excluded. Set to `null` to disable the filter.
 */
const INSTALL_DATE_CUTOFF: string | null = '2024-01-01';

// ---------------------------------------------------------------------------
// Request-time read, per-(tenant, jobs-version, lineitems-version) cache.
// ---------------------------------------------------------------------------

interface DbCacheSlot {
  versionKey: string;
  data: WriteOffsFile;
}

const dbCache = new Map<number, DbCacheSlot>();

async function getWriteOffsFromDb(tenantId: number): Promise<WriteOffsFile> {
  // CHEAP cache-key probe first: pull just the promoted-run-id lists for
  // both sources before any heavy fetch. Keeps cache hits at ~10ms.
  const [jobIds, lineItemsIds] = await Promise.all([
    promotedVersionIds(tenantId, 'rooflink_jobs'),
    promotedVersionIds(tenantId, 'rooflink_lineitems'),
  ]);
  const versionKey = `${jobIds.join(',')}|${lineItemsIds.join(',')}`;

  const cached = dbCache.get(tenantId);
  if (cached && cached.versionKey === versionKey) return cached.data;

  // Cache miss — do the (now narrowed) fetch. SQL pre-filters jobs to those
  // with a primary_estimate.id AND date_completed >= INSTALL_DATE_CUTOFF, so
  // we transfer ~400-2000 candidate jobs instead of all ~120k.
  const [jobRows, lineItemsRows] = await Promise.all([
    getLiveJobsForWriteOffs(tenantId, INSTALL_DATE_CUTOFF),
    getLiveLineItems(tenantId),
  ]);

  // Build a payload lookup keyed by estimateId. Line-item rows store their
  // natural key separately from the payload, so we don't have to dig into
  // the payload to index.
  const payloadByEstimateId = new Map<string, unknown>();
  for (const row of lineItemsRows) {
    payloadByEstimateId.set(row.estimateId, row.payload);
  }

  // Project each (job, payload) pair into a WriteOffRecord. Scope is
  // all-estimates (no AR working-set filter); the install-date cutoff is
  // applied in SQL (above).
  const records: WriteOffRecord[] = [];
  let candidatesFetched = 0;
  const fetchErrors = 0;
  let skipped404 = 0;

  for (const row of jobRows) {
    const parsed = RoofLinkJobSchema.safeParse(row.payload);
    if (!parsed.success) continue;
    const job: RoofLinkJob = parsed.data;

    const estimateId = job.primary_estimate?.id;
    if (estimateId == null) continue;

    candidatesFetched += 1;
    const payload = payloadByEstimateId.get(String(estimateId));
    if (payload == null) {
      // No line-items row for this estimate yet — analogous to a 404 from
      // the seed script. Count it so the dashboard surface can flag
      // partial coverage.
      skipped404 += 1;
      continue;
    }

    const record = toWriteOffRecord(job, payload);
    if (!record) continue;

    // Install-date cutoff is enforced in SQL by getLiveJobsForWriteOffs.
    // No redundant TS filter here.

    records.push(record);
  }

  records.sort((a, b) => b.amountWithheld - a.amountWithheld);

  const totalAmountWithheld = records.reduce((s, r) => s + r.amountWithheld, 0);

  const data: WriteOffsFile = WriteOffsFileSchema.parse({
    generatedAt: new Date().toISOString(),
    scope: 'all-estimates',
    totals: {
      candidatesFetched,
      candidatesWithWriteOffs: records.length,
      totalAmountWithheld,
      fetchErrors,
      skipped404,
    },
    records,
  });

  dbCache.set(tenantId, { versionKey, data });
  return data;
}

/**
 * Drop any cached write-offs snapshot for a tenant. Called by the backfill
 * tick worker after a successful promote on either source so the next
 * request recomputes.
 */
export function invalidateWriteOffsSnapshot(tenantId: number): void {
  dbCache.delete(tenantId);
}

// ---------------------------------------------------------------------------
// Public entry points.
// ---------------------------------------------------------------------------

export async function getWriteOffs(tenantId: number): Promise<WriteOffsFile> {
  return getWriteOffsFromDb(tenantId);
}

/**
 * Session-aware variant for the write-offs server page. Same defense-in-depth
 * shape as `getDataForCurrentSession` in `lib/data.ts` — the dashboard
 * middleware already gates the page.
 */
export async function getWriteOffsForCurrentSession(): Promise<WriteOffsFile> {
  const session = await auth();
  const tenantId = session?.user?.tenantId;
  if (typeof tenantId !== 'number') {
    throw new Error(
      '[lib/write-offs-data] getWriteOffsForCurrentSession called without a tenant-bound session.',
    );
  }
  return getWriteOffs(tenantId);
}
