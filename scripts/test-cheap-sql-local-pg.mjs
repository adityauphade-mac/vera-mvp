#!/usr/bin/env node
/**
 * End-to-end test of the cheap-SQL fix against the LOCAL Postgres (vera_dev).
 *
 * Why local: Neon's data-transfer quota is exhausted, so we can't run the
 * test against the production-shared DB. Local Postgres has the same schema
 * (via Prisma migrations), so the SQL we'd run there will behave the same
 * here, just at lower network latency.
 *
 * What this script does:
 *   1. Connects to local vera_dev (port 5432, user aditya.uphade).
 *   2. Creates a temp dataVersion (test_run_id = 999_999) in BackfillRun.
 *   3. Streams data/jobs_dedup.jsonl, batch-INSERTs all ~103k rows into
 *      RawRooflinkJob under that dataVersion.
 *   4. Runs the OLD (broken) query: SELECT payload from all rows. Times it.
 *   5. Runs the NEW (cheap) SQL: extracts just the IDs. Times it.
 *   6. Reports row counts, byte-transfer estimates, timing comparison.
 *   7. Cleans up (deletes the test rows).
 *
 * The local-vs-Neon timing won't be identical (no cross-region network hop),
 * but the SAME-MACHINE ratio between OLD and NEW is the same logic that
 * applies on Neon. If NEW is 30x faster locally, it'll be 30x faster on Neon
 * (and the absolute speedup is even bigger because Neon's network is slower).
 *
 * Usage:
 *   node scripts/test-cheap-sql-local-pg.mjs
 *   node scripts/test-cheap-sql-local-pg.mjs --keep     # don't clean up
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
const TEST_DATA_VERSION = 999_999;
const TEST_TENANT_ID = 1;
const BATCH_SIZE = 1_000;
const KEEP = process.argv.includes('--keep');

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

  // Step 1: ensure test tenant exists. Tenant schema doesn't carry updatedAt
  // (Prisma manages mutation timestamps via @updatedAt on other models).
  await c.query(
    `INSERT INTO "Tenant" (id, slug, name, "createdAt")
     VALUES ($1, 'test-perf', 'Perf Test', NOW())
     ON CONFLICT (id) DO NOTHING`,
    [TEST_TENANT_ID],
  );

  // Step 2: prepare a clean test dataVersion.
  await c.query(`DELETE FROM "RawRooflinkJob" WHERE "dataVersion" = $1`, [TEST_DATA_VERSION]);
  await c.query(`DELETE FROM "BackfillRun" WHERE id = $1`, [TEST_DATA_VERSION]);
  await c.query(
    `INSERT INTO "BackfillRun" (id, "tenantId", source, status, mode, promoted, "startedAt", "finishedAt", "itemsProcessed")
     VALUES ($1, $2, 'rooflink_jobs', 'completed', 'full', true, NOW(), NOW(), 0)`,
    [TEST_DATA_VERSION, TEST_TENANT_ID],
  );
  console.log(`  → created test BackfillRun #${TEST_DATA_VERSION}`);

  // Step 3: stream JSONL and batch-INSERT into RawRooflinkJob.
  console.log('\n— Loading rows from JSONL —');
  const stream = createReadStream(JSONL_PATH);
  const rl = createInterface({ input: stream, crlfDelay: Infinity });

  let buffer = [];
  let totalLoaded = 0;
  const loadT0 = process.hrtime.bigint();

  async function flush() {
    if (buffer.length === 0) return;
    // Build a parameterized multi-row INSERT.
    const vals = [];
    const params = [];
    let pi = 1;
    for (const { rooflinkId, payload } of buffer) {
      vals.push(`($${pi++}, $${pi++}, $${pi++}::jsonb, NOW())`);
      params.push(rooflinkId, TEST_DATA_VERSION, payload);
    }
    await c.query(
      `INSERT INTO "RawRooflinkJob" ("rooflinkId", "dataVersion", payload, "fetchedAt") VALUES ${vals.join(',')}`,
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
  const loadT1 = process.hrtime.bigint();
  const loadMs = Number(loadT1 - loadT0) / 1_000_000;
  console.log(`\r  loaded ${totalLoaded.toLocaleString()} rows in ${(loadMs / 1000).toFixed(1)}s`);

  // Step 4: OLD (current/broken) query — SELECT payload from every row.
  console.log('\n— Running OLD query (current code: SELECT payload) —');
  const oldT0 = process.hrtime.bigint();
  const oldRes = await c.query(`SELECT payload FROM "RawRooflinkJob" WHERE "dataVersion" = $1`, [
    TEST_DATA_VERSION,
  ]);
  const oldT1 = process.hrtime.bigint();
  const oldMs = Number(oldT1 - oldT0) / 1_000_000;

  // Estimate transfer size: sum payload byte sizes.
  let oldTransferBytes = 0;
  for (const r of oldRes.rows) {
    oldTransferBytes += JSON.stringify(r.payload).length;
  }
  console.log(`  → ${oldRes.rowCount.toLocaleString()} rows, ~${(oldTransferBytes / 1_000_000).toFixed(1)} MB transferred, ${oldMs.toFixed(0)} ms`);

  // Then filter in JS (what the current code does).
  const jsFilterT0 = process.hrtime.bigint();
  const oldExtractedIds = [];
  for (const row of oldRes.rows) {
    const p = row.payload;
    const eid = p?.primary_estimate?.id;
    if (eid != null) {
      oldExtractedIds.push({ id: String(eid), date_last_edited: p?.date_last_edited ?? null });
    }
  }
  const jsFilterT1 = process.hrtime.bigint();
  const jsFilterMs = Number(jsFilterT1 - jsFilterT0) / 1_000_000;
  console.log(`  → JS filter+extract: ${oldExtractedIds.length.toLocaleString()} ids in ${jsFilterMs.toFixed(0)} ms`);
  console.log(`  → TOTAL old path: ${(oldMs + jsFilterMs).toFixed(0)} ms wall, ~${(oldTransferBytes / 1_000_000).toFixed(1)} MB transferred`);

  // Step 5: NEW (cheap) SQL — server-side extraction.
  console.log('\n— Running NEW query (cheap SQL: server-side extract) —');
  const newT0 = process.hrtime.bigint();
  const newRes = await c.query(
    `SELECT
       payload->'primary_estimate'->>'id'   AS id,
       payload->>'date_last_edited'         AS date_last_edited
     FROM "RawRooflinkJob"
     WHERE "dataVersion" = $1
       AND payload->'primary_estimate'->>'id' IS NOT NULL`,
    [TEST_DATA_VERSION],
  );
  const newT1 = process.hrtime.bigint();
  const newMs = Number(newT1 - newT0) / 1_000_000;

  let newTransferBytes = 0;
  for (const r of newRes.rows) {
    newTransferBytes += (r.id?.length ?? 0) + (r.date_last_edited?.length ?? 0);
  }
  console.log(`  → ${newRes.rowCount.toLocaleString()} ids, ~${(newTransferBytes / 1000).toFixed(0)} KB transferred, ${newMs.toFixed(0)} ms`);

  // Step 6: correctness — both should produce the same IDs.
  console.log('\n— Correctness check —');
  const oldSet = new Set(oldExtractedIds.map((x) => x.id));
  const newSet = new Set(newRes.rows.map((x) => x.id));
  const sameSize = oldSet.size === newSet.size;
  let allMatch = sameSize;
  if (sameSize) {
    for (const id of oldSet) {
      if (!newSet.has(id)) {
        allMatch = false;
        break;
      }
    }
  }
  console.log(`  • old returned: ${oldSet.size.toLocaleString()} ids`);
  console.log(`  • new returned: ${newSet.size.toLocaleString()} ids`);
  console.log(`  • ID sets match: ${allMatch ? 'YES ✓' : 'NO ✗'}`);

  // Step 7: summary.
  console.log('\n— Summary —');
  console.log(`              | OLD path             | NEW path             | Ratio`);
  console.log(`  ------------|----------------------|----------------------|---------`);
  console.log(`  Rows over wire | ${oldRes.rowCount.toLocaleString().padEnd(20)} | ${newRes.rowCount.toLocaleString().padEnd(20)} | (filter at DB)`);
  console.log(`  Bytes        | ${(oldTransferBytes / 1_000_000).toFixed(1) + ' MB'.padStart(8)} | ${(newTransferBytes / 1000).toFixed(0) + ' KB'.padStart(8)} | ${Math.round(oldTransferBytes / Math.max(1, newTransferBytes))}× less`);
  console.log(`  Wall time    | ${(oldMs + jsFilterMs).toFixed(0) + ' ms'.padStart(7)} | ${newMs.toFixed(0) + ' ms'.padStart(7)} | ${((oldMs + jsFilterMs) / Math.max(1, newMs)).toFixed(1)}× faster`);

  // Cleanup.
  if (KEEP) {
    console.log(`\n— Keeping test data (--keep). Use scripts/test-cheap-sql-local-pg.mjs without --keep to clean up. —`);
  } else {
    await c.query(`DELETE FROM "RawRooflinkJob" WHERE "dataVersion" = $1`, [TEST_DATA_VERSION]);
    await c.query(`DELETE FROM "BackfillRun" WHERE id = $1`, [TEST_DATA_VERSION]);
    console.log(`\n— Cleaned up test rows —`);
  }

  await c.end();
}

main().catch((e) => {
  console.error('FATAL:', e.message ?? e);
  process.exit(1);
});
