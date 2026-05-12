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
 * Promoted run IDs for a (tenant, source). Always includes the most recent
 * full sync plus any later incrementals on top — i.e., the snapshot chain
 * that constitutes "live".
 *
 * If there's a full sync at run #10 and incrementals at #11, #12, #13, all
 * with promoted=true, this returns [10, 11, 12, 13]. The DISTINCT ON in
 * getLive* picks the latest version per record.
 */
async function promotedVersionIds(
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
