#!/usr/bin/env node
/**
 * Load data/jobs_dedup.jsonl into local vera_dev as a fresh promoted run.
 *
 * Sets up a realistic test fixture for the integration smoke test:
 *   1. Demotes any existing promoted rooflink_jobs runs (preserves rows).
 *   2. Creates a new BackfillRun for rooflink_jobs marked promoted+completed.
 *   3. Streams the 197 MB JSONL into RawRooflinkJob under that dataVersion.
 *
 * Result: local vera_dev looks like Neon did right after run #13 promoted,
 * but without ever calling Rooflink. ~5 seconds to set up.
 *
 * Usage:
 *   node scripts/load-jsonl-into-local.mjs
 */
import { createReadStream, existsSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const { Client } = pg;

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const JSONL_PATH = join(ROOT, 'data/jobs_dedup.jsonl');
const TENANT_ID = 1;
const BATCH_SIZE = 1_000;

if (!existsSync(JSONL_PATH)) {
  console.error(`Missing ${JSONL_PATH}`);
  process.exit(1);
}

async function main() {
  const c = new Client({
    host: 'localhost',
    port: 5432,
    user: 'aditya.uphade',
    database: 'vera_dev',
  });
  await c.connect();
  console.log('— Connected to local vera_dev —');

  // Step 1: demote existing promoted rooflink_jobs runs (preserve rows).
  const demoteRes = await c.query(
    `UPDATE "BackfillRun" SET promoted = false
     WHERE source = 'rooflink_jobs' AND promoted = true
     RETURNING id`,
  );
  if (demoteRes.rows.length > 0) {
    console.log(
      `  → demoted prior promoted rooflink_jobs runs: ${demoteRes.rows.map((r) => '#' + r.id).join(', ')}`,
    );
  } else {
    console.log('  → no prior promoted rooflink_jobs runs to demote');
  }

  // Step 2: create a fresh BackfillRun for rooflink_jobs.
  const newRun = (
    await c.query(
      `INSERT INTO "BackfillRun"
        ("tenantId", source, status, mode, promoted, "startedAt", "finishedAt", "itemsProcessed")
       VALUES ($1, 'rooflink_jobs', 'completed', 'full', true, NOW(), NOW(), 0)
       RETURNING id`,
      [TENANT_ID],
    )
  ).rows[0];
  const dataVersion = newRun.id;
  console.log(`  → created BackfillRun #${dataVersion} (promoted)`);

  // Step 3: bulk-load JSONL into RawRooflinkJob.
  console.log('\n— Loading JSONL —');
  const t0 = process.hrtime.bigint();

  const stream = createReadStream(JSONL_PATH);
  const rl = createInterface({ input: stream, crlfDelay: Infinity });
  let buffer = [];
  let totalLoaded = 0;

  async function flush() {
    if (buffer.length === 0) return;
    const vals = [];
    const params = [];
    let pi = 1;
    for (const { rooflinkId, payload } of buffer) {
      vals.push(`($${pi++}, $${pi++}, $${pi++}::jsonb, NOW())`);
      params.push(rooflinkId, dataVersion, payload);
    }
    await c.query(
      `INSERT INTO "RawRooflinkJob" ("rooflinkId", "dataVersion", payload, "fetchedAt")
       VALUES ${vals.join(',')}
       ON CONFLICT ("rooflinkId", "dataVersion") DO NOTHING`,
      params,
    );
    totalLoaded += buffer.length;
    buffer = [];
  }

  for await (const line of rl) {
    if (!line) continue;
    let obj;
    try {
      obj = JSON.parse(line);
    } catch {
      continue;
    }
    if (obj.id == null) continue;
    buffer.push({ rooflinkId: String(obj.id), payload: line });
    if (buffer.length >= BATCH_SIZE) {
      await flush();
      if (totalLoaded % 10_000 === 0) {
        process.stdout.write(`\r  loaded ${totalLoaded.toLocaleString()} rows...`);
      }
    }
  }
  await flush();
  const t1 = process.hrtime.bigint();
  const elapsed = Number(t1 - t0) / 1_000_000;
  console.log(`\r  loaded ${totalLoaded.toLocaleString()} rows in ${(elapsed / 1000).toFixed(1)}s`);

  // Update itemsProcessed on the run for accuracy.
  await c.query(`UPDATE "BackfillRun" SET "itemsProcessed" = $1 WHERE id = $2`, [
    totalLoaded,
    dataVersion,
  ]);

  // Summary.
  const summary = await c.query(`
    SELECT COUNT(*)::int AS total,
           COUNT(*) FILTER (WHERE payload->'primary_estimate'->>'id' IS NOT NULL)::int AS with_estimate
    FROM "RawRooflinkJob"
    WHERE "dataVersion" = $1
  `, [dataVersion]);
  console.log('\n— Loaded fixture state —');
  console.log(`  promoted dataVersion:           ${dataVersion}`);
  console.log(`  total rows in fixture:          ${summary.rows[0].total.toLocaleString()}`);
  console.log(`  rows with primary_estimate.id:  ${summary.rows[0].with_estimate.toLocaleString()}`);
  console.log(`\nLocal vera_dev is now ready for the lineitems smoke test.`);

  await c.end();
}

main().catch((e) => {
  console.error('FATAL:', e.message ?? e);
  process.exit(1);
});
