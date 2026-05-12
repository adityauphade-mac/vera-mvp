/**
 * Fetches Amount Withheld write-offs for the AR working set.
 *
 * For every AR-set job with a primary_estimate.id, fetches
 * /estimates/{id}/lineitems/, filters discounts[] for product_id 71493
 * (Amount Withheld), and writes a slim summary + full line-item payload
 * to apps/web/data/write-offs.json — same pattern as preprocess.ts.
 *
 * 1 req/sec, matching backfill.py. AR-set is ~130 estimates → ~2.5 min.
 *
 * Run with: pnpm exec tsx scripts/fetch-write-offs.ts
 */
import { createReadStream, existsSync } from 'node:fs';
import { writeFile, mkdir } from 'node:fs/promises';
import readline from 'node:readline';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { isInARWorkingSet } from '@vera/domain';
import { RoofLinkJobSchema, type RoofLinkJob } from '@vera/types';

const AMOUNT_WITHHELD_PRODUCT_ID = 71493;
const RL_KEY = process.env.RL_KEY;
const REQ_DELAY_MS = 1000;
const FETCH_TIMEOUT_MS = 30_000;

if (!RL_KEY) {
  console.error('RL_KEY env var required');
  process.exit(1);
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const SOURCE = path.join(ROOT, 'data', 'jobs_dedup.jsonl');
const OUT_DIR = path.join(ROOT, 'apps', 'web', 'data');
const OUT = path.join(OUT_DIR, 'write-offs.json');

interface DiscountLine {
  id: number;
  product_id: number;
  product_name: string;
  price: number;
  trade_name?: string | null;
  note?: string | null;
}

interface LineItemsPayload {
  work_doing?: Array<{ rcv?: number; price?: number }>;
  work_not_doing?: unknown[];
  supplineitems?: unknown[];
  changeorderitems?: unknown[];
  upgrades?: unknown[];
  discounts?: DiscountLine[];
  summary?: unknown;
}

interface WriteOffRecord {
  jobId: number;
  estimateId: number;
  customerName: string;
  address: string;
  installDate: string | null;
  repName: string | null;
  region: string | null;
  amountWithheld: number;
  contractPrice: number;
  balance: number;
  insuranceRcv: number | null;
  lineItems: LineItemsPayload;
}

interface WriteOffsFile {
  generatedAt: string;
  scope: 'ar-working-set';
  totals: {
    candidatesFetched: number;
    candidatesWithWriteOffs: number;
    totalAmountWithheld: number;
    fetchErrors: number;
    skipped404: number;
  };
  records: WriteOffRecord[];
}

async function fetchJson(url: string): Promise<{ status: number; body: unknown }> {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      headers: { 'X-API-KEY': RL_KEY!, Accept: 'application/json' },
      signal: controller.signal,
    });
    if (res.status === 200) {
      return { status: 200, body: await res.json() };
    }
    return { status: res.status, body: null };
  } finally {
    clearTimeout(t);
  }
}

function sumWorkDoingRcv(payload: LineItemsPayload): number | null {
  const items = payload.work_doing;
  if (!Array.isArray(items) || items.length === 0) return null;
  return items.reduce((sum, item) => sum + (typeof item.rcv === 'number' ? item.rcv : 0), 0);
}

async function main(): Promise<void> {
  if (!existsSync(SOURCE)) {
    console.error(`source file not found: ${SOURCE}`);
    process.exit(1);
  }

  console.log('Pass 1: streaming JSONL, filtering to AR working set...');
  const candidates: Array<{ job: RoofLinkJob; estimateId: number }> = [];
  const stream = createReadStream(SOURCE, { encoding: 'utf8' });
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });

  for await (const line of rl) {
    if (!line.trim()) continue;
    let raw: unknown;
    try {
      raw = JSON.parse(line);
    } catch {
      continue;
    }
    const parsed = RoofLinkJobSchema.safeParse(raw);
    if (!parsed.success) continue;
    const job = parsed.data;
    if (!isInARWorkingSet(job)) continue;
    const eid = job.primary_estimate?.id;
    if (eid == null) continue;
    candidates.push({ job, estimateId: Number(eid) });
  }

  console.log(`  ${candidates.length} AR-set candidates with primary_estimate.id`);
  const estMin = Math.ceil((candidates.length * REQ_DELAY_MS) / 60_000);
  console.log(`  expected runtime: ~${estMin} min at 1 req/sec\n`);
  console.log('Pass 2: fetching line items from Rooflink...');

  const records: WriteOffRecord[] = [];
  let withWriteOff = 0;
  let fetchErrors = 0;
  let skipped404 = 0;
  let totalWithheld = 0;
  const t0 = Date.now();

  for (let i = 0; i < candidates.length; i++) {
    const { job, estimateId } = candidates[i]!;
    try {
      const { status, body } = await fetchJson(
        `https://integrate.rooflink.com/roof_link_endpoints/api/light/estimates/${estimateId}/lineitems/`,
      );
      if (status === 401 || status === 403) {
        throw new Error(`auth error: HTTP ${status} — check RL_KEY`);
      } else if (status === 404) {
        skipped404++;
      } else if (status !== 200) {
        fetchErrors++;
        console.warn(`  [${i + 1}/${candidates.length}] estimate ${estimateId}: HTTP ${status}`);
      } else {
        const payload = body as LineItemsPayload;
        const withheld = (payload.discounts ?? []).find(
          (d) => d.product_id === AMOUNT_WITHHELD_PRODUCT_ID,
        );
        if (withheld) {
          const amount = Math.abs(withheld.price);
          totalWithheld += amount;
          withWriteOff++;
          records.push({
            jobId: job.id,
            estimateId,
            customerName: job.customer?.name ?? '',
            address: job.full_address ?? job.address ?? '',
            installDate: job.date_completed ?? null,
            repName: job.rep?.full_name ?? null,
            region: job.region?.name ?? null,
            amountWithheld: amount,
            contractPrice: job.primary_estimate?.gt_price ?? 0,
            balance: job.primary_estimate?.balance ?? 0,
            insuranceRcv: sumWorkDoingRcv(payload),
            lineItems: payload,
          });
        }
      }
    } catch (e) {
      fetchErrors++;
      console.warn(
        `  [${i + 1}/${candidates.length}] estimate ${estimateId}: ${(e as Error).message}`,
      );
    }

    if ((i + 1) % 10 === 0 || i === candidates.length - 1) {
      const elapsedSec = Math.floor((Date.now() - t0) / 1000);
      const totalFmt = Math.round(totalWithheld).toLocaleString();
      console.log(
        `  [${i + 1}/${candidates.length}] ${withWriteOff} write-offs · $${totalFmt} total · ${elapsedSec}s elapsed`,
      );
    }

    if (i < candidates.length - 1) {
      await new Promise((r) => setTimeout(r, REQ_DELAY_MS));
    }
  }

  records.sort((a, b) => b.amountWithheld - a.amountWithheld);

  const out: WriteOffsFile = {
    generatedAt: new Date().toISOString(),
    scope: 'ar-working-set',
    totals: {
      candidatesFetched: candidates.length,
      candidatesWithWriteOffs: withWriteOff,
      totalAmountWithheld: totalWithheld,
      fetchErrors,
      skipped404,
    },
    records,
  };

  await mkdir(OUT_DIR, { recursive: true });
  await writeFile(OUT, JSON.stringify(out, null, 2));

  const totalSec = Math.floor((Date.now() - t0) / 1000);
  console.log();
  console.log(`Done in ${totalSec}s.`);
  console.log(`  wrote ${records.length} write-off record(s) → ${OUT}`);
  console.log(`  total Amount Withheld: $${totalWithheld.toLocaleString(undefined, { maximumFractionDigits: 2 })}`);
  if (skipped404 > 0) console.log(`  skipped (404, estimate not found): ${skipped404}`);
  if (fetchErrors > 0) console.log(`  fetch errors: ${fetchErrors}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
