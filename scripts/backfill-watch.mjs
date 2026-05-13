#!/usr/bin/env node
/**
 * One-shot backfill driver + watcher.
 *
 *   - Creates a fresh BackfillRun row directly via SQL (bypasses the
 *     session-auth POST endpoint so we don't need to mint a cookie).
 *   - POSTs the first tick to /api/cron/backfill-tick with Bearer
 *     CRON_SECRET. Subsequent ticks chain themselves via the dev fallback
 *     in lib/backfill/qstash.ts.
 *   - Polls BackfillRun every 10 seconds and logs progress until the run
 *     terminates (completed or failed).
 *
 * Usage:
 *   node scripts/backfill-watch.mjs rooflink_jobs
 *   node scripts/backfill-watch.mjs rooflink_lineitems
 *
 * Reads DATABASE_URL and CRON_SECRET from apps/web/.env.local.
 */
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const { Client } = pg;

const SOURCE = process.argv[2];
if (SOURCE !== 'rooflink_jobs' && SOURCE !== 'rooflink_lineitems') {
  console.error(`Usage: node scripts/backfill-watch.mjs <rooflink_jobs|rooflink_lineitems>`);
  process.exit(2);
}

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const ENV_PATH = join(ROOT, 'apps/web/.env.local');
const TENANT_ID = 1;
const POLL_MS = 10_000;
const ORIGIN = process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:3000';

function loadEnv() {
  if (!existsSync(ENV_PATH)) {
    console.error(`Missing ${ENV_PATH}`);
    process.exit(1);
  }
  const env = readFileSync(ENV_PATH, 'utf8');
  for (const line of env.split('\n')) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/i);
    if (!m) continue;
    let val = m[2].trim();
    if (val.startsWith('"') && val.endsWith('"')) val = val.slice(1, -1);
    if (!process.env[m[1]]) process.env[m[1]] = val;
  }
}
loadEnv();

const DATABASE_URL = process.env.DATABASE_URL;
const CRON_SECRET = process.env.CRON_SECRET;
if (!DATABASE_URL || !CRON_SECRET) {
  console.error('DATABASE_URL and CRON_SECRET must be set in apps/web/.env.local');
  process.exit(1);
}

const db = new Client({ connectionString: DATABASE_URL });
await db.connect();

function fmtTs(d) {
  if (!d) return '—';
  return new Date(d).toISOString().slice(11, 19);
}

async function readRun(id) {
  const r = await db.query(
    `SELECT id, status, mode, promoted, "itemsProcessed", "itemsTotal",
            "consecutiveErrors", "errorCount", "claimedAt",
            "startedAt", "finishedAt", "lastError", cursor
     FROM "BackfillRun" WHERE id = $1`,
    [id],
  );
  return r.rows[0] ?? null;
}

async function rowsWritten(runId, source) {
  const table = source === 'rooflink_jobs' ? '"RawRooflinkJob"' : '"RawRooflinkLineItems"';
  const r = await db.query(`SELECT COUNT(*)::int AS n FROM ${table} WHERE "dataVersion" = $1`, [
    runId,
  ]);
  return r.rows[0]?.n ?? 0;
}

async function createRun() {
  // Check inflight first — POST endpoint refuses with 409 if a run is
  // queued/running; we mirror that defensively.
  const inflight = await db.query(
    `SELECT id FROM "BackfillRun"
     WHERE "tenantId" = $1 AND source = $2 AND status IN ('queued','running')
     ORDER BY id DESC LIMIT 1`,
    [TENANT_ID, SOURCE],
  );
  if (inflight.rows[0]) {
    console.warn(`! Existing in-flight run #${inflight.rows[0].id} — reusing it.`);
    return inflight.rows[0].id;
  }
  const r = await db.query(
    `INSERT INTO "BackfillRun" ("tenantId", source, status, mode, "startedAt", "claimedAt")
     VALUES ($1, $2, 'running', 'full', NOW(), NULL)
     RETURNING id`,
    [TENANT_ID, SOURCE],
  );
  return r.rows[0].id;
}

async function kickFirstTick(runId) {
  const res = await fetch(`${ORIGIN}/api/cron/backfill-tick`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${CRON_SECRET}`,
    },
    body: JSON.stringify({ runId }),
  });
  const text = await res.text();
  return { status: res.status, body: text };
}

function diffSec(from, to) {
  return Math.round((to.getTime() - from.getTime()) / 1000);
}

async function pollUntilDone(runId, source) {
  let lastProcessed = -1;
  let lastChangeAt = Date.now();
  let firstSeenTotal = false;
  while (true) {
    await new Promise((r) => setTimeout(r, POLL_MS));
    const run = await readRun(runId);
    if (!run) {
      console.error(`✗ run #${runId} vanished from DB`);
      return run;
    }
    const written = await rowsWritten(runId, source);
    const elapsed = run.startedAt ? diffSec(run.startedAt, new Date()) : 0;
    const pct =
      run.itemsTotal && run.itemsTotal > 0
        ? `${Math.min(100, ((run.itemsProcessed / run.itemsTotal) * 100)).toFixed(1)}%`
        : '—';
    const silent = Math.round((Date.now() - lastChangeAt) / 1000);
    console.log(
      `[t+${elapsed}s] #${runId} ${run.status} processed=${run.itemsProcessed}/${run.itemsTotal ?? '?'} (${pct}) rows-in-db=${written} errs=${run.consecutiveErrors}/${run.errorCount} cursor=${run.cursor ? 'set' : 'none'} ${silent > 0 ? `silent=${silent}s` : ''}`,
    );
    if (run.itemsProcessed !== lastProcessed) {
      lastProcessed = run.itemsProcessed;
      lastChangeAt = Date.now();
    }
    if (run.itemsTotal && !firstSeenTotal) {
      firstSeenTotal = true;
      console.log(`  → itemsTotal observed: ${run.itemsTotal.toLocaleString()} rows to fetch`);
    }
    if (run.status === 'completed' || run.status === 'failed' || run.status === 'canceled') {
      return run;
    }
    // Safety: if nothing has progressed for 5 minutes and no errors, the
    // tick chain has stalled. Surface and exit so the operator can decide.
    if (silent > 300 && run.consecutiveErrors === 0) {
      console.error(`✗ run #${runId} is silent for ${silent}s with no errors — tick chain appears stalled.`);
      return run;
    }
  }
}

async function main() {
  console.log(`-- Backfill watcher · source=${SOURCE} · tenant=${TENANT_ID} --`);
  console.log(`   DB:   ${DATABASE_URL.replace(/:[^:@/]*@/, ':***@')}`);
  console.log(`   App:  ${ORIGIN}`);

  const runId = await createRun();
  console.log(`+ created/reused run #${runId} · kicking first tick…`);
  const kicked = await kickFirstTick(runId);
  console.log(`  tick POST → ${kicked.status} ${kicked.body.slice(0, 120)}`);

  const final = await pollUntilDone(runId, SOURCE);
  if (!final) return;
  console.log(`\n-- Run terminal state --`);
  console.log(
    `   #${final.id} ${final.status} processed=${final.itemsProcessed}/${final.itemsTotal ?? '?'} promoted=${final.promoted} duration=${final.startedAt && final.finishedAt ? diffSec(final.startedAt, final.finishedAt) : '—'}s`,
  );
  if (final.lastError) console.log(`   lastError: ${final.lastError}`);
}

try {
  await main();
} catch (e) {
  console.error('fatal:', e);
} finally {
  await db.end();
}
