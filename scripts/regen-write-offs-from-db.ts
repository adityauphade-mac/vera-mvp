/**
 * Regenerate apps/web/data/write-offs.json from the local Postgres
 * (`vera_dev`), this time WITHOUT the AR working-set filter.
 *
 * Background: per the 2026-05-13 conversation with Israel, the original
 * AR-working-set filter was too narrow — it hid paid-off jobs and
 * not-yet-completed jobs whose estimates carry an Amount Withheld
 * discount. This script surfaces ANY job (with a primary_estimate.id)
 * whose line-items payload has an Amount Withheld line.
 *
 * Reads:
 *   - RawRooflinkJob       (latest promoted run, expected: #131)
 *   - RawRooflinkLineItems (latest promoted run, expected: #135)
 *
 * Writes:
 *   - apps/web/data/write-offs.json  (scope: 'all-estimates')
 *
 * Run with: pnpm exec tsx scripts/regen-write-offs-from-db.ts
 */
import { writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

import { toWriteOffRecord } from '@vera/domain';
import {
  RoofLinkJobSchema,
  WriteOffsFileSchema,
  type WriteOffRecord,
  type WriteOffsFile,
} from '@vera/types';

const { Client } = pg;

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const OUT_DIR = path.join(ROOT, 'apps', 'web', 'data');
const OUT = path.join(OUT_DIR, 'write-offs.json');

const TENANT_ID = 1;

/**
 * Filter: only include jobs whose install (date_completed) is on or after
 * this date. Per the 2026-05-13 conversation with Israel, historical
 * pre-2024 write-offs are noise — the team only acts on recent installs.
 * Null install dates (jobs not yet completed) are also excluded.
 *
 * To remove the filter, set to `null`.
 */
const INSTALL_DATE_CUTOFF: string | null = '2024-01-01';

interface RawJobRow {
  rooflinkId: string;
  payload: unknown;
}

interface RawLineItemsRow {
  estimateId: string;
  payload: unknown;
}

async function main(): Promise<void> {
  const c = new Client({
    host: 'localhost',
    port: 5432,
    user: 'aditya.uphade',
    database: 'vera_dev',
  });
  await c.connect();
  console.log('— Connected to local vera_dev —');

  const jobsVersionRes = await c.query<{ id: number }>(
    `SELECT id FROM "BackfillRun"
     WHERE "tenantId" = $1 AND source = 'rooflink_jobs' AND promoted = true
     ORDER BY id DESC LIMIT 1`,
    [TENANT_ID],
  );
  const lineItemsVersionRes = await c.query<{ id: number }>(
    `SELECT id FROM "BackfillRun"
     WHERE "tenantId" = $1 AND source = 'rooflink_lineitems' AND promoted = true
     ORDER BY id DESC LIMIT 1`,
    [TENANT_ID],
  );

  const jobsVersion = jobsVersionRes.rows[0]?.id;
  const lineItemsVersion = lineItemsVersionRes.rows[0]?.id;
  if (jobsVersion == null || lineItemsVersion == null) {
    console.error('Missing promoted run for jobs or line items.');
    process.exit(1);
  }
  console.log(
    `  promoted versions: jobs=${jobsVersion}, lineitems=${lineItemsVersion}`,
  );

  console.log('Loading line items...');
  const lineItemsRes = await c.query<RawLineItemsRow>(
    `SELECT "estimateId", payload
     FROM "RawRooflinkLineItems"
     WHERE "dataVersion" = $1`,
    [lineItemsVersion],
  );
  const payloadByEstimateId = new Map<string, unknown>();
  for (const row of lineItemsRes.rows) {
    payloadByEstimateId.set(row.estimateId, row.payload);
  }
  console.log(`  ${payloadByEstimateId.size.toLocaleString()} line-item payloads loaded`);

  console.log('Streaming jobs and projecting write-offs (no AR filter)...');
  const jobsRes = await c.query<RawJobRow>(
    `SELECT DISTINCT ON ("rooflinkId") "rooflinkId", payload
     FROM "RawRooflinkJob"
     WHERE "dataVersion" = $1
     ORDER BY "rooflinkId", "dataVersion" DESC`,
    [jobsVersion],
  );
  console.log(`  ${jobsRes.rows.length.toLocaleString()} jobs scanned`);

  const records: WriteOffRecord[] = [];
  let candidatesScanned = 0;
  let skippedNoEstimate = 0;
  let skippedNoLineItems = 0;
  let skippedByDateFilter = 0;
  let totalWithheld = 0;
  const cutoffMs = INSTALL_DATE_CUTOFF
    ? new Date(INSTALL_DATE_CUTOFF).getTime()
    : null;

  for (const row of jobsRes.rows) {
    const parsed = RoofLinkJobSchema.safeParse(row.payload);
    if (!parsed.success) continue;
    const job = parsed.data;

    const estimateId = job.primary_estimate?.id;
    if (estimateId == null) {
      skippedNoEstimate++;
      continue;
    }

    candidatesScanned++;
    const payload = payloadByEstimateId.get(String(estimateId));
    if (payload == null) {
      skippedNoLineItems++;
      continue;
    }

    const record = toWriteOffRecord(job, payload);
    if (!record) continue;

    if (cutoffMs !== null) {
      if (record.installDate == null) {
        skippedByDateFilter++;
        continue;
      }
      const installMs = new Date(record.installDate).getTime();
      if (Number.isNaN(installMs) || installMs < cutoffMs) {
        skippedByDateFilter++;
        continue;
      }
    }

    records.push(record);
    totalWithheld += record.amountWithheld;
  }

  records.sort((a, b) => b.amountWithheld - a.amountWithheld);

  const out: WriteOffsFile = WriteOffsFileSchema.parse({
    generatedAt: new Date().toISOString(),
    scope: 'all-estimates',
    totals: {
      candidatesFetched: candidatesScanned,
      candidatesWithWriteOffs: records.length,
      totalAmountWithheld: totalWithheld,
      fetchErrors: 0,
      skipped404: skippedNoLineItems,
    },
    records,
  });

  await mkdir(OUT_DIR, { recursive: true });
  await writeFile(OUT, JSON.stringify(out, null, 2));

  console.log();
  console.log('Done.');
  console.log(`  scope:               all-estimates`);
  console.log(`  jobs scanned:        ${jobsRes.rows.length.toLocaleString()}`);
  console.log(`  candidates fetched:  ${candidatesScanned.toLocaleString()}`);
  console.log(`  skipped (no estimate): ${skippedNoEstimate.toLocaleString()}`);
  console.log(`  skipped (no line-items row): ${skippedNoLineItems.toLocaleString()}`);
  console.log(
    `  skipped (install date < ${INSTALL_DATE_CUTOFF ?? 'n/a'}): ${skippedByDateFilter.toLocaleString()}`,
  );
  console.log(`  records written:     ${records.length.toLocaleString()}`);
  console.log(
    `  total Amount Withheld: $${totalWithheld.toLocaleString(undefined, { maximumFractionDigits: 2 })}`,
  );
  console.log(`  output:              ${OUT}`);

  await c.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
