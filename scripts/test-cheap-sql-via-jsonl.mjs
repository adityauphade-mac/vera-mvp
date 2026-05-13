#!/usr/bin/env node
/**
 * Offline verification of the cheap-SQL logic.
 *
 * Neon's data-transfer quota is exhausted right now, so we can't run the
 * cheap SQL against the live DB. But the SQL extracts the same two fields
 * (`payload.primary_estimate.id`, `payload.date_last_edited`) from the same
 * row data we already have in `data/jobs_dedup.jsonl`.
 *
 * This script streams that JSONL file and applies the same logic in JS:
 *   - filter to rows where primary_estimate.id IS NOT NULL
 *   - extract that id and date_last_edited
 *
 * If the row count and ID samples match what we'd expect from the DB
 * (~8,500 estimate ids), the cheap SQL is correct by logical equivalence.
 * Once Neon's quota resets, we can re-run scripts/test-cheap-sql.mjs to
 * confirm against the live DB.
 *
 * Usage:
 *   node scripts/test-cheap-sql-via-jsonl.mjs
 */
import { createReadStream, existsSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const JSONL_PATH = join(ROOT, 'data/jobs_dedup.jsonl');

if (!existsSync(JSONL_PATH)) {
  console.error(`Missing ${JSONL_PATH}`);
  process.exit(1);
}

async function main() {
  console.log('— Reading data/jobs_dedup.jsonl —');
  console.log(`  path: ${JSONL_PATH}`);

  let totalRows = 0;
  let withPrimaryEstimate = 0;
  let withDate = 0;
  let parseErrors = 0;
  const samples = []; // first 5

  const t0 = process.hrtime.bigint();

  const stream = createReadStream(JSONL_PATH);
  const rl = createInterface({ input: stream, crlfDelay: Infinity });

  for await (const line of rl) {
    if (!line) continue;
    totalRows++;
    let obj;
    try {
      obj = JSON.parse(line);
    } catch {
      parseErrors++;
      continue;
    }
    // This is the exact same projection the cheap SQL does:
    //   payload->'primary_estimate'->>'id'   AS id
    //   payload->>'date_last_edited'         AS date_last_edited
    // Plus the same filter:
    //   payload->'primary_estimate'->>'id' IS NOT NULL
    const id = obj?.primary_estimate?.id;
    if (id == null) continue;
    withPrimaryEstimate++;
    const dle = obj?.date_last_edited ?? null;
    if (dle) withDate++;
    if (samples.length < 5) {
      samples.push({ id: String(id), date_last_edited: dle });
    }
  }

  const t1 = process.hrtime.bigint();
  const elapsedMs = Number(t1 - t0) / 1_000_000;

  console.log(`\n— Results —`);
  console.log(`  total rows scanned:               ${totalRows.toLocaleString()}`);
  console.log(`  rows with primary_estimate.id:    ${withPrimaryEstimate.toLocaleString()}  ← cheap SQL would return this many`);
  console.log(`  rows with date_last_edited:       ${withDate.toLocaleString()}`);
  console.log(`  parse errors (skipped):           ${parseErrors.toLocaleString()}`);
  console.log(`  wall time (streaming + parsing):  ${(elapsedMs / 1000).toFixed(2)} s`);

  console.log(`\n— Sample (first 5 matching rows) —`);
  for (const s of samples) {
    console.log(`  id=${s.id}  date_last_edited=${s.date_last_edited ?? '(none)'}`);
  }

  console.log(`\nThis JSONL has the same row data the DB was backfilled with.`);
  console.log(`The cheap SQL would return ${withPrimaryEstimate.toLocaleString()} ids with the same`);
  console.log(`filter & extraction logic — server-side instead of client-side.`);
}

main().catch((e) => {
  console.error('FATAL:', e.message ?? e);
  process.exit(1);
});
