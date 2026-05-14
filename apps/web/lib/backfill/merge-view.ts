import 'server-only';
import { db } from '@/lib/db';
import type { BackfillSource } from './sources';

/**
 * Merge view — "the latest live snapshot" of a Rooflink source, computed
 * from every promoted BackfillRun.
 *
 * With full-only syncs (V1), exactly one run is promoted at a time and
 * reading it directly was fine. Incremental sync (V2) keeps a chain of
 * promoted runs — one full + N incrementals — so the live snapshot is
 * "latest row per natural key across all promoted versions".
 *
 * Postgres makes this efficient with `DISTINCT ON ... ORDER BY ... DESC`:
 * for each natural key, return the row with the highest dataVersion among
 * promoted runs. Indexed on `(dataVersion)` and `(source, promoted)` so the
 * planner can prune aggressively.
 *
 * NOTE: this module is NOT yet wired into the dashboard API routes — those
 * still read `generated.json`. It's the foundation for the JSON-to-DB
 * cutover work, kept here so the incremental sync changes don't depend on
 * that cutover landing first.
 */

export interface RawJobRow {
  rooflinkId: string;
  dataVersion: number;
  payload: unknown;
  fetchedAt: Date;
}

export interface RawLineItemsRow {
  estimateId: string;
  dataVersion: number;
  payload: unknown;
  fetchedAt: Date;
}

/** A row from {@link getLiveARJobsWithContext}: an AR-eligible job plus the
 * cross-population context the domain transform needs (currently just the
 * duplicate-address count, since that's the only anomaly that crosses jobs).
 *
 * The SQL applies the AR working-set filter (`isInARWorkingSet` from
 * `@vera/domain/classification`) so the result is already narrowed — Node
 * never sees the ~120,000-row full population. */
export interface ARJobContextRow {
  payload: unknown;
  addressCount: number;
  fetchedAt: Date;
}

/** A row from {@link getLiveJobsForWriteOffs}: a job that has a
 * primary_estimate.id AND a non-null `date_completed` >= `installDateCutoff`.
 * Drops the ~120k-row population to ~400 rows server-side. */
export interface WriteOffJobRow {
  payload: unknown;
  fetchedAt: Date;
}

/**
 * Fetch the latest live snapshot of rooflink_jobs as one row per rooflinkId.
 * Returns all jobs in the current snapshot — caller is expected to filter
 * downstream.
 */
export async function getLiveJobs(tenantId: number): Promise<RawJobRow[]> {
  const promotedVersions = await promotedVersionIds(tenantId, 'rooflink_jobs');
  if (promotedVersions.length === 0) return [];
  // DISTINCT ON in raw SQL — Prisma's findMany can't express "highest
  // dataVersion per rooflinkId" in one query.
  return db.$queryRaw<RawJobRow[]>`
    SELECT DISTINCT ON ("rooflinkId")
      "rooflinkId", "dataVersion", payload, "fetchedAt"
    FROM "RawRooflinkJob"
    WHERE "dataVersion" = ANY(${promotedVersions})
    ORDER BY "rooflinkId", "dataVersion" DESC
  `;
}

/**
 * Fetch the latest live snapshot of rooflink_lineitems as one row per
 * estimateId. Same merge semantics as getLiveJobs.
 */
export async function getLiveLineItems(tenantId: number): Promise<RawLineItemsRow[]> {
  const promotedVersions = await promotedVersionIds(tenantId, 'rooflink_lineitems');
  if (promotedVersions.length === 0) return [];
  return db.$queryRaw<RawLineItemsRow[]>`
    SELECT DISTINCT ON ("estimateId")
      "estimateId", "dataVersion", payload, "fetchedAt"
    FROM "RawRooflinkLineItems"
    WHERE "dataVersion" = ANY(${promotedVersions})
    ORDER BY "estimateId", "dataVersion" DESC
  `;
}

/**
 * AR working-set snapshot, narrowed in SQL.
 *
 * The legacy `getLiveJobs` returned the entire ~120,000-row population so
 * Node could filter/aggregate. That made every cold cache miss ship ~200 MB
 * across the wire — fine on localhost, fatal from a Vercel function to a
 * remote Cloud SQL.
 *
 * This variant does three things server-side:
 *
 *   1. **DISTINCT ON** — latest payload per `rooflinkId` across the promoted
 *      version chain (full + incrementals). Same as `getLiveJobs`.
 *   2. **AR working-set filter** — mirrors `isInARWorkingSet` from
 *      `@vera/domain/classification`:
 *        - `exclude_from_qb` not `true`
 *        - `date_completed` not null
 *        - `primary_estimate.balance > 0`
 *   3. **Duplicate-address count** — computed over the *full* population in a
 *      CTE, joined into the output as `address_count`. This is the only
 *      cross-row context the domain transform needs (everything else in
 *      `toARJob` is per-job).
 *
 * Output is ~130 rows × full payload + one int ≈ 220 KB instead of 200 MB.
 *
 * NB: the AR filter logic MUST stay in sync with
 * `shared/domain/src/classification.ts → isInARWorkingSet`. If that function
 * changes, this WHERE clause changes.
 */
export async function getLiveARJobsWithContext(
  tenantId: number,
): Promise<ARJobContextRow[]> {
  const promotedVersions = await promotedVersionIds(tenantId, 'rooflink_jobs');
  if (promotedVersions.length === 0) return [];
  return db.$queryRaw<ARJobContextRow[]>`
    WITH latest AS (
      SELECT DISTINCT ON ("rooflinkId")
        "rooflinkId",
        payload,
        "fetchedAt"
      FROM "RawRooflinkJob"
      WHERE "dataVersion" = ANY(${promotedVersions})
      ORDER BY "rooflinkId", "dataVersion" DESC
    ),
    addr_counts AS (
      SELECT
        TRIM(LOWER(COALESCE(payload->>'full_address', payload->>'address', ''))) AS addr,
        COUNT(*)::int AS cnt
      FROM latest
      WHERE LENGTH(TRIM(COALESCE(payload->>'full_address', payload->>'address', ''))) > 0
      GROUP BY 1
      HAVING COUNT(*) > 1
    )
    SELECT
      latest.payload,
      COALESCE(addr_counts.cnt, 1)::int AS "addressCount",
      latest."fetchedAt"
    FROM latest
    LEFT JOIN addr_counts
      ON addr_counts.addr = TRIM(LOWER(COALESCE(latest.payload->>'full_address', latest.payload->>'address', '')))
    WHERE (latest.payload->>'exclude_from_qb' IS NULL OR latest.payload->>'exclude_from_qb' != 'true')
      AND latest.payload->>'date_completed' IS NOT NULL
      AND (latest.payload->'primary_estimate'->>'balance')::numeric > 0
  `;
}

/**
 * Write-offs snapshot, narrowed in SQL.
 *
 * The write-offs dashboard scope is "all-estimates with install_date >=
 * cutoff" — broader than the AR working set (per the May 13 broadening), but
 * still much narrower than the full 120k-row population. Pushes the date
 * cutoff and the `primary_estimate.id IS NOT NULL` filter into Postgres so we
 * transfer ~400-500 rows instead of all 120k.
 *
 * `installDateCutoff` should match the `INSTALL_DATE_CUTOFF` constant in
 * `apps/web/lib/write-offs-data.ts` so the two scopes agree.
 */
export async function getLiveJobsForWriteOffs(
  tenantId: number,
  installDateCutoff: string | null,
): Promise<WriteOffJobRow[]> {
  const promotedVersions = await promotedVersionIds(tenantId, 'rooflink_jobs');
  if (promotedVersions.length === 0) return [];
  // Use a SQL CASE to make the cutoff optional — when null, the date filter
  // becomes a no-op.
  return db.$queryRaw<WriteOffJobRow[]>`
    WITH latest AS (
      SELECT DISTINCT ON ("rooflinkId")
        "rooflinkId",
        payload,
        "fetchedAt"
      FROM "RawRooflinkJob"
      WHERE "dataVersion" = ANY(${promotedVersions})
      ORDER BY "rooflinkId", "dataVersion" DESC
    )
    SELECT payload, "fetchedAt"
    FROM latest
    WHERE payload->'primary_estimate'->>'id' IS NOT NULL
      AND (
        ${installDateCutoff}::text IS NULL
        OR (
          payload->>'date_completed' IS NOT NULL
          AND (payload->>'date_completed')::date >= ${installDateCutoff}::date
        )
      )
  `;
}

/**
 * Promoted run IDs for a (tenant, source). Always includes the most recent
 * full sync plus any later incrementals on top — i.e., the snapshot chain
 * that constitutes "live".
 *
 * If there's a full sync at run #10 and incrementals at #11, #12, #13, all
 * with promoted=true, this returns [10, 11, 12, 13]. The DISTINCT ON in
 * getLive* picks the latest version per record.
 */
export async function promotedVersionIds(
  tenantId: number,
  source: BackfillSource,
): Promise<number[]> {
  const rows = await db.backfillRun.findMany({
    where: {
      tenantId,
      source,
      promoted: true,
      status: 'completed',
    },
    select: { id: true },
    orderBy: { id: 'asc' },
  });
  return rows.map((r) => r.id);
}
