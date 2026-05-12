import 'server-only';
import { createReadStream, existsSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { resolve } from 'node:path';
import type { BackfillSource } from './sources';
import { db } from '@/lib/db';

/**
 * Rooflink API client. Single entry point per source. When `RL_KEY` is unset
 * (i.e. local dev), the client returns mock-fixture data instead — same
 * shape, deterministic, no network calls. This lets the full tick + cursor +
 * promotion flow be tested end-to-end without hitting the real API.
 *
 * The real fetch logic mirrors the resumability + rate-limit patterns from
 * `backfill.py`: 1 request/second, fail-fast on auth, append-only.
 */

const RL_KEY = process.env.RL_KEY;
export function isLiveMode(): boolean {
  return Boolean(RL_KEY);
}

// Rooflink exposes two distinct URL trees:
//   /light/public/jobs/           — bulk list (the jobs backfill)
//   /light/estimates/{id}/lineitems/ — per-estimate detail (lineitems)
// No `/public/` segment on the estimate path.
const BASE_PUBLIC = 'https://integrate.rooflink.com/roof_link_endpoints/api/light/public';
const BASE_LIGHT = 'https://integrate.rooflink.com/roof_link_endpoints/api/light';
const REQ_DELAY_MS = 1000;
/** Hard ceiling on a single Rooflink fetch. Rooflink responds in 1–2s when
 *  fresh, but under WAF throttle (after sustained traffic) a page_size=100
 *  request can take 10+ seconds. 30s leaves headroom without letting a
 *  truly hung request stall the tick. */
const FETCH_TIMEOUT_MS = 30_000;
/** When Rooflink returns 429, back off this long before the next attempt. */
const RATE_LIMIT_BACKOFF_MS = 5_000;
const MAX_429_RETRIES = 3;

export interface FetchResult {
  /** rooflinkId | estimateId (whichever is the natural key for this source) */
  id: string;
  /** Raw API payload — written into the Raw* JSONB column verbatim. */
  payload: unknown;
}

export interface BatchResult {
  items: FetchResult[];
  /** Opaque token to pass back on the next call; null means "we're done". */
  nextCursor: string | null;
  /** Total items the source has, if known. Stable across calls within a run. */
  itemsTotal: number | null;
}

/**
 * Fetch one batch from a source. The shape of `cursor` is opaque to callers —
 * sources interpret it themselves.
 *
 * `since`: when set, the fetcher returns only records with
 * `date_last_edited > since`. For the jobs endpoint this is pushed to Rooflink
 * as a query parameter; for lineitems we filter the estimate-id list locally.
 * Null = full re-fetch (no filter).
 */
export async function fetchBatch(
  source: BackfillSource,
  cursor: string | null,
  batchSize: number,
  since: Date | null,
): Promise<BatchResult> {
  if (!isLiveMode()) {
    return fetchMock(source, cursor, batchSize, since);
  }
  if (source === 'rooflink_jobs') {
    return fetchJobsBatch(cursor, batchSize, since);
  }
  return fetchLineItemsBatch(cursor, batchSize, since);
}

async function fetchJobsBatch(
  cursor: string | null,
  batchSize: number,
  since: Date | null,
): Promise<BatchResult> {
  // cursor = next page URL (or null on first call → build the start URL).
  // On the first page we apply the `date_last_edited__gte` filter; Rooflink's
  // `next` URL preserves the filter for subsequent pages, so we don't need to
  // re-apply it on every iteration.
  let url: string;
  if (cursor) {
    url = cursor;
  } else {
    const params = new URLSearchParams({
      ordering: '-date_last_edited',
      page_size: '100',
    });
    if (since) {
      // Rooflink rejects `.toISOString()` (e.g. `2026-05-04T00:00:00.000Z`)
      // with `Enter a valid date/time.` It accepts `YYYY-MM-DD HH:MM:SS` —
      // space-separated, no `T`, no `Z`. Verified empirically against the
      // live API.
      params.set('date_last_edited__gte', toRooflinkDateTime(since));
    }
    url = `${BASE_PUBLIC}/jobs/?${params.toString()}`;
  }

  const items: FetchResult[] = [];
  let nextUrl: string | null = url;
  let total: number | null = null;

  // `batchSize` for jobs = pages per tick. Each page is ~100 jobs.
  for (let i = 0; i < batchSize && nextUrl; i++) {
    const { body } = await curlGet(nextUrl);
    const data = JSON.parse(body) as {
      next: string | null;
      count?: number;
      results: Array<{ id: number | string; [key: string]: unknown }>;
    };
    if (typeof data.count === 'number' && total === null) {
      total = data.count;
    }
    for (const row of data.results) {
      items.push({ id: String(row.id), payload: row });
    }
    nextUrl = data.next;
    if (i < batchSize - 1 && nextUrl) {
      await sleep(REQ_DELAY_MS);
    }
  }

  return { items, nextCursor: nextUrl, itemsTotal: total };
}

async function fetchLineItemsBatch(
  cursor: string | null,
  batchSize: number,
  since: Date | null,
): Promise<BatchResult> {
  // Read the list of estimate IDs to walk from the latest promoted
  // RawRooflinkJob version. Each job payload has a `primary_estimate` object
  // (or null); we only fetch lineitems for jobs that have one.
  // When `since` is set, we filter the list down to estimates whose
  // `primary_estimate.date_last_edited` is newer than the watermark.
  const ids = await loadEstimateIds(since);
  if (ids.length === 0) {
    if (since) {
      // Incremental run with no changes since the watermark — empty batch,
      // exhausted cursor. The tick worker treats this as completed.
      return { items: [], nextCursor: null, itemsTotal: 0 };
    }
    throw new Error(
      'rooflink_lineitems: no promoted RawRooflinkJob version found. ' +
        'Run a rooflink_jobs backfill first so this can iterate its estimate ids.',
    );
  }

  const startIdx = cursor ? parseInt(cursor, 10) : 0;
  const endIdx = Math.min(startIdx + batchSize, ids.length);
  const items: FetchResult[] = [];
  let skipped404 = 0;

  for (let i = startIdx; i < endIdx; i++) {
    const estimateId = ids[i];
    if (!estimateId) continue;
    const url = `${BASE_LIGHT}/estimates/${estimateId}/lineitems/`;
    const { code, body } = await curlGet(url);
    if (code === 401 || code === 403) {
      throw new Error(`auth error fetching lineitems for estimate ${estimateId}: HTTP ${code}`);
    }
    if (code === 404) {
      // Estimate present in our snapshot but deleted/archived in Rooflink.
      // Common: the jobs_dedup.jsonl was captured at one point; some
      // estimates have since been pruned. Skip and advance the cursor —
      // this is NOT a fatal error.
      skipped404++;
      continue;
    }
    if (code !== 200) {
      throw new Error(`HTTP ${code} fetching lineitems for estimate ${estimateId}`);
    }
    let payload: unknown;
    try {
      payload = JSON.parse(body);
    } catch {
      throw new Error(`parse error for estimate ${estimateId}: ${body.slice(0, 160)}`);
    }
    items.push({ id: estimateId, payload });
    if (i < endIdx - 1) {
      await sleep(REQ_DELAY_MS);
    }
  }

  if (skipped404 > 0) {
    // eslint-disable-next-line no-console
    console.log(
      `[backfill] lineitems batch [${startIdx}..${endIdx}]: skipped ${skipped404} deleted estimate(s)`,
    );
  }

  const nextCursor = endIdx < ids.length ? String(endIdx) : null;
  return { items, nextCursor, itemsTotal: ids.length };
}

/**
 * Load the list of estimate ids to walk for lineitems. Two sources, in order:
 *
 *   1. The most recent promoted+completed RawRooflinkJob version. This is
 *      the steady-state path once `rooflink_jobs` has been backfilled into
 *      the DB.
 *   2. Fallback to streaming `data/jobs_dedup.jsonl` — the existing 187MB
 *      file from the Python backfill. This unblocks lineitems testing
 *      before the (slow, WAF-throttled) DB rebuild finishes.
 *
 * When `since` is set, the result is filtered down to estimates whose
 * `primary_estimate.date_last_edited` is newer than the watermark.
 *
 * The JSONL parse is cached at module scope (full id list — filtering is
 * applied each call). 187MB only gets read once per Node process.
 * Hot-reloads of this module clear the cache.
 */
interface CachedEstimate {
  id: string;
  /** ISO 8601 string, or null if the source record had no edit timestamp. */
  dateLastEdited: string | null;
}
let cachedJsonlEstimates: CachedEstimate[] | null = null;

async function loadEstimateIds(since: Date | null): Promise<string[]> {
  const all = await loadEstimatesWithTimestamps();
  if (!since) return all.map((e) => e.id);
  const cutoff = since.getTime();
  return all
    .filter((e) => {
      if (!e.dateLastEdited) return true; // unknown edit time → include to be safe
      return new Date(e.dateLastEdited).getTime() > cutoff;
    })
    .map((e) => e.id);
}

async function loadEstimatesWithTimestamps(): Promise<CachedEstimate[]> {
  // Path 1 — DB-backed promoted version.
  const latest = await db.backfillRun.findFirst({
    where: { source: 'rooflink_jobs', promoted: true, status: 'completed' },
    orderBy: { id: 'desc' },
  });
  if (latest) {
    const rows = await db.rawRooflinkJob.findMany({
      where: { dataVersion: latest.id },
      select: { payload: true },
    });
    if (rows.length > 0) {
      const out: CachedEstimate[] = [];
      for (const row of rows) {
        // The JOB's `date_last_edited` is what we filter on for incremental
        // — the `primary_estimate` object itself doesn't carry that field.
        const p = row.payload as {
          date_last_edited?: string | null;
          primary_estimate?: { id: number | string } | null;
        } | null;
        const eid = p?.primary_estimate?.id;
        if (eid != null) {
          out.push({
            id: String(eid),
            dateLastEdited: p?.date_last_edited ?? null,
          });
        }
      }
      if (out.length > 0) return out;
    }
  }

  // Path 2 — JSONL fallback.
  return loadEstimatesFromJsonl();
}

async function loadEstimatesFromJsonl(): Promise<CachedEstimate[]> {
  if (cachedJsonlEstimates) return cachedJsonlEstimates;
  const jsonlPath = resolve(process.cwd(), '../../data/jobs_dedup.jsonl');
  if (!existsSync(jsonlPath)) {
    throw new Error(
      `rooflink_lineitems: no promoted RawRooflinkJob version found, and the ` +
        `fallback file ${jsonlPath} does not exist. Either complete a ` +
        `rooflink_jobs backfill first, or run scripts/setup-worktree.sh to ` +
        `copy data/jobs_dedup.jsonl into this worktree.`,
    );
  }
  // eslint-disable-next-line no-console
  console.log(
    `[backfill] loading estimate ids from ${jsonlPath} (no promoted DB version yet)`,
  );
  const out: CachedEstimate[] = [];
  const stream = createReadStream(jsonlPath);
  const rl = createInterface({ input: stream, crlfDelay: Infinity });
  for await (const line of rl) {
    if (!line) continue;
    try {
      const obj = JSON.parse(line) as {
        date_last_edited?: string | null;
        primary_estimate?: { id: number | string } | null;
      };
      const eid = obj.primary_estimate?.id;
      if (eid != null) {
        // Filter on the JOB's date_last_edited — the JSONL's
        // primary_estimate object doesn't carry that field.
        out.push({
          id: String(eid),
          dateLastEdited: obj.date_last_edited ?? null,
        });
      }
    } catch {
      /* skip malformed lines */
    }
  }
  cachedJsonlEstimates = out;
  // eslint-disable-next-line no-console
  console.log(`[backfill] loaded ${out.length.toLocaleString()} estimate ids from JSONL`);
  return out;
}

async function fetchMock(
  source: BackfillSource,
  cursor: string | null,
  batchSize: number,
  since: Date | null,
): Promise<BatchResult> {
  // Deterministic small fixtures so a "Run now" in dev completes in a few
  // ticks. itemsTotal is intentionally tiny (60 + 40) so the UI shows
  // realistic progress without sitting on localhost for 2.5h.
  //
  // To exercise incremental sync: each mock record has a synthetic
  // `date_last_edited` set N minutes ago (N = index). So records 0..9 are
  // "fresh" (edited 0..9 minutes ago); records 50+ are "stale" (50+ min
  // old). An incremental sync with since = "10 min ago" returns only the
  // first 10 records.
  const baseTotal = source === 'rooflink_jobs' ? 60 : 40;
  const mockBaseDate = new Date('2026-05-11T12:00:00Z').getTime();
  const allRecords = Array.from({ length: baseTotal }, (_, i) => {
    const dateLastEdited = new Date(mockBaseDate - i * 60_000).toISOString();
    return {
      id: i,
      source,
      mock: true,
      gt_price: 10000 + i * 137,
      date_created: '2026-05-01T00:00:00Z',
      date_last_edited: dateLastEdited,
      primary_estimate:
        source === 'rooflink_jobs'
          ? {
              id: 100_000 + i,
              date_last_edited: dateLastEdited,
            }
          : undefined,
      notes: `Mock record ${i} for ${source}`,
    };
  });
  // Apply `since` filter — only records edited after the watermark.
  const filtered = since
    ? allRecords.filter((r) => new Date(r.date_last_edited).getTime() > since.getTime())
    : allRecords;

  const total = filtered.length;
  const start = cursor ? parseInt(cursor, 10) : 0;
  const end = Math.min(start + batchSize, total);
  const items: FetchResult[] = [];
  for (let i = start; i < end; i++) {
    const rec = filtered[i];
    if (!rec) continue;
    items.push({
      id: `${source}-mock-${String(rec.id).padStart(5, '0')}`,
      payload: rec,
    });
    await sleep(5);
  }
  const nextCursor = end < total ? String(end) : null;
  return { items, nextCursor, itemsTotal: total };
}

async function curlGet(url: string): Promise<{ code: number; body: string }> {
  // Retry 429s a couple of times. Anything else (200, 4xx, 5xx, timeout)
  // bubbles out to the tick worker, which counts toward consecutive errors.
  for (let attempt = 0; attempt <= MAX_429_RETRIES; attempt++) {
    const controller = new AbortController();
    const timeoutHandle = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    try {
      const res = await fetch(url, {
        headers: {
          'X-API-KEY': RL_KEY ?? '',
          Accept: 'application/json',
        },
        signal: controller.signal,
      });
      const body = await res.text();
      if (res.status === 429 && attempt < MAX_429_RETRIES) {
        await sleep(RATE_LIMIT_BACKOFF_MS);
        continue;
      }
      return { code: res.status, body };
    } catch (e) {
      if (e instanceof Error && e.name === 'AbortError') {
        throw new Error(`Rooflink request timed out after ${FETCH_TIMEOUT_MS}ms: ${url}`);
      }
      throw e;
    } finally {
      clearTimeout(timeoutHandle);
    }
  }
  // Unreachable — the loop either returns or throws.
  throw new Error('curlGet: exhausted retries');
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** UTC `YYYY-MM-DD HH:MM:SS` — the format Rooflink accepts on date filters. */
function toRooflinkDateTime(d: Date): string {
  const pad = (n: number): string => String(n).padStart(2, '0');
  return (
    `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ` +
    `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`
  );
}
