/**
 * Generator for `tests/fixtures/vera_test.sql` — the seed that
 * `setup-vera-test.sh` loads into the local `vera_test` Postgres DB so
 * Playwright specs run against deterministic data.
 *
 * Inputs:
 *   - tests/fixtures/generated.fixture.json   (slim AR job set, 130 rows)
 *   - apps/web/data/write-offs.json           (write-off records, 373 rows)
 *
 * Output:
 *   - tests/fixtures/vera_test.sql            (checked-in)
 *
 * What it emits:
 *   - 1 Tenant row (id=1, matches DEFAULT_TEST_USER.tenantId)
 *   - 1 User row (id=1, email matches DEFAULT_TEST_USER.email)
 *   - 2 BackfillRun rows: jobs (id=1) + lineitems (id=2), both
 *     `promoted=true`, `status='completed'`, `mode='full'`
 *   - N RawRooflinkJob rows where N = union(slim AR jobIds, WO jobIds)
 *   - M RawRooflinkLineItems rows where M = WO record count
 *   - `SELECT setval(...)` calls to advance id sequences past seeded values
 *
 * Why this shape: the raw RoofLinkJob payload is what `lib/data.ts` and
 * `lib/write-offs-data.ts` read via the DB path. The dashboard's domain
 * transforms (`toARJob`, `toWriteOffRecord`, etc.) ingest these payloads
 * and produce the same numbers the JSON path produces today — so existing
 * spec assertions should hold without rewrites, modulo a few aggregate
 * rounding artifacts that we may need to absorb in spec updates.
 *
 * Run:
 *   pnpm exec tsx scripts/generate-vera-test-seed.ts
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const REPO_ROOT = resolve(__dirname, '..');
const AR_FIXTURE = resolve(REPO_ROOT, 'tests/fixtures/generated.fixture.json');
const WO_FIXTURE = resolve(REPO_ROOT, 'apps/web/data/write-offs.json');
const OUT_FILE = resolve(REPO_ROOT, 'tests/fixtures/vera_test.sql');

// Hardcoded so they match `DEFAULT_TEST_USER` in tests/e2e/_helpers/auth.ts.
const TENANT_ID = 1;
const USER_ID = 1;
const USER_EMAIL = 'adityauphade@makanalytics.org';
const JOBS_RUN_ID = 1;
const LINEITEMS_RUN_ID = 2;

// ─────────────────────────────────────────────────────────────────────────
// Source shapes (loose — we only read what we need).
// ─────────────────────────────────────────────────────────────────────────

interface SlimRep {
  id: number;
  name: string;
  email: string | null;
  color: string | null;
}

interface SlimARJob {
  id: number;
  address: string | null;
  fullAddress: string | null;
  city: string | null;
  state: string | null;
  region: string | null;
  jobType: string | null;
  customerName: string | null;
  rep: SlimRep | null;
  leadStatus: string | null;
  leadSource: string | null;
  dateCreated?: string | null;
  dateSigned?: string | null;
  dateCompleted: string | null;
  dateLastEdited: string | null;
  gtPrice: number;
  payments: number;
  balance: number;
  commissions: number;
  excludeFromQB: boolean;
  warrantyVoided: boolean;
  isArchived: boolean;
  isInsurance: boolean;
  netTerms: number;
}

interface SlimFixture {
  generatedAt: string;
  asOf: string;
  jobCount: number;
  totalAR: number;
  jobs: SlimARJob[];
  reps: unknown[];
}

interface WORecord {
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
  lineItems: Record<string, unknown>;
}

interface WOFixture {
  generatedAt: string;
  scope: string;
  totals: Record<string, unknown>;
  records: WORecord[];
}

// ─────────────────────────────────────────────────────────────────────────
// Raw Rooflink shapes we synthesize.
//
// These mirror the subset of fields the dashboard reads via
// `RoofLinkJobSchema` in shared/types/src/index.ts. The schema uses
// `.passthrough()` so extra fields are kept, and most fields are
// `.nullish()` so omitted ones default to null/undefined.
// ─────────────────────────────────────────────────────────────────────────

interface RawJobPayload {
  id: number;
  job_type: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  full_address: string | null;
  region: { name: string | null } | null;
  rep: {
    id: number | null;
    full_name: string | null;
    email: string | null;
    color: string | null;
  } | null;
  customer: { name: string | null } | null;
  lead_status: { label: string | null } | null;
  lead_source: { name: string | null } | null;
  date_created: string | null;
  date_signed: string | null;
  date_completed: string | null;
  date_last_edited: string | null;
  primary_estimate: {
    id: number | null;
    gt_price: number | null;
    payments: number | null;
    balance: number | null;
    commissions: number | null;
    is_primary: boolean;
    is_archived: boolean;
  };
  exclude_from_qb: boolean;
  warranty_voided: boolean;
}

// ─────────────────────────────────────────────────────────────────────────
// Synthesis helpers.
// ─────────────────────────────────────────────────────────────────────────

/** Build a raw payload from a slim AR job. */
function fromSlim(job: SlimARJob, estimateId: number | null): RawJobPayload {
  return {
    id: job.id,
    job_type: job.jobType,
    address: job.address,
    city: job.city,
    state: job.state,
    full_address: job.fullAddress,
    region: job.region ? { name: job.region } : null,
    rep: job.rep
      ? {
          id: job.rep.id,
          full_name: job.rep.name,
          email: job.rep.email,
          color: job.rep.color,
        }
      : null,
    customer: job.customerName ? { name: job.customerName } : null,
    lead_status: job.leadStatus ? { label: job.leadStatus } : null,
    lead_source: job.leadSource ? { name: job.leadSource } : null,
    date_created: job.dateCreated ?? null,
    date_signed: job.dateSigned ?? null,
    date_completed: job.dateCompleted,
    date_last_edited: job.dateLastEdited,
    primary_estimate: {
      id: estimateId,
      gt_price: job.gtPrice,
      payments: job.payments,
      balance: job.balance,
      commissions: job.commissions,
      is_primary: true,
      is_archived: job.isArchived,
    },
    exclude_from_qb: job.excludeFromQB,
    warranty_voided: job.warrantyVoided,
  };
}

/** Build a raw payload from a WO-only record (no slim-fixture match). */
function fromWO(rec: WORecord): RawJobPayload {
  // Some fields aren't present in WO records — keep them null. The slim
  // fixture's broader shape isn't available here, but the AR working-set
  // filter (`isInARWorkingSet`) doesn't include these WO-only jobs anyway
  // (they have balance=0 typically), so the dashboard's AR view only
  // surfaces them via the write-offs page, which reads
  // (jobId, customerName, address, estimateId, lineItems) — all present.
  return {
    id: rec.jobId,
    job_type: null,
    address: null,
    city: null,
    state: null,
    full_address: rec.address,
    region: rec.region ? { name: rec.region } : null,
    rep: rec.repName
      ? { id: null, full_name: rec.repName, email: null, color: null }
      : null,
    customer: rec.customerName ? { name: rec.customerName } : null,
    lead_status: null,
    lead_source: null,
    date_created: null,
    date_signed: null,
    // Install date is the closest proxy for date_completed.
    date_completed: rec.installDate,
    date_last_edited: rec.installDate,
    primary_estimate: {
      id: rec.estimateId,
      gt_price: rec.contractPrice,
      payments: null,
      balance: rec.balance,
      commissions: null,
      is_primary: true,
      is_archived: false,
    },
    exclude_from_qb: false,
    warranty_voided: false,
  };
}

// ─────────────────────────────────────────────────────────────────────────
// SQL emission helpers.
// ─────────────────────────────────────────────────────────────────────────

/** Escape a single-quoted SQL string literal. */
function sqlString(s: string | null | undefined): string {
  if (s == null) return 'NULL';
  return `'${s.replace(/'/g, "''")}'`;
}

/** Stringify a payload as a jsonb literal. */
function sqlJsonb(obj: unknown): string {
  const json = JSON.stringify(obj).replace(/'/g, "''");
  return `'${json}'::jsonb`;
}

// ─────────────────────────────────────────────────────────────────────────
// Main.
// ─────────────────────────────────────────────────────────────────────────

function main(): void {
  console.log(`[seed] reading ${AR_FIXTURE}`);
  const ar = JSON.parse(readFileSync(AR_FIXTURE, 'utf8')) as SlimFixture;
  console.log(`[seed] reading ${WO_FIXTURE}`);
  const wo = JSON.parse(readFileSync(WO_FIXTURE, 'utf8')) as WOFixture;

  // Index WO records by jobId — used when a slim AR job also has a write-off.
  const woByJobId = new Map<number, WORecord>();
  for (const rec of wo.records) {
    woByJobId.set(rec.jobId, rec);
  }

  // Build the unified job set. AR jobs first (so primary_estimate.id is
  // attached when there's a WO match); WO-only records appended.
  const jobPayloads: RawJobPayload[] = [];
  const slimIds = new Set<number>();
  for (const j of ar.jobs) {
    const woMatch = woByJobId.get(j.id);
    jobPayloads.push(fromSlim(j, woMatch ? woMatch.estimateId : null));
    slimIds.add(j.id);
  }
  for (const rec of wo.records) {
    if (slimIds.has(rec.jobId)) continue;
    jobPayloads.push(fromWO(rec));
  }

  console.log(
    `[seed] jobs: ${ar.jobs.length} AR slim + ${wo.records.length - ar.jobs.filter((j) => woByJobId.has(j.id)).length} WO-only = ${jobPayloads.length} unique`,
  );

  // Line-item payloads: one per WO record. The `lineItems` field is
  // already in raw Rooflink shape (the write-offs seed script fetched
  // them straight from /lineitems/ and stored the response intact).
  const lineItems = wo.records.map((rec) => ({
    estimateId: rec.estimateId,
    payload: rec.lineItems,
  }));
  console.log(`[seed] lineitems: ${lineItems.length}`);

  // Compute id sequence high-water marks (the seed hardcodes ids 1 + 2
  // for BackfillRun, so we advance the sequence to start at 3).
  const maxBackfillId = Math.max(JOBS_RUN_ID, LINEITEMS_RUN_ID);

  // ───────────────────────────────────────────────────────────────────────
  // Build the SQL.
  // ───────────────────────────────────────────────────────────────────────
  const lines: string[] = [];
  lines.push('-- AUTOGENERATED by scripts/generate-vera-test-seed.ts');
  lines.push('-- DO NOT EDIT BY HAND. Re-run the script to regenerate.');
  lines.push(`-- Generated: ${new Date().toISOString()}`);
  lines.push(`-- Source AR fixture: tests/fixtures/generated.fixture.json (${ar.jobs.length} AR jobs)`);
  lines.push(`-- Source WO fixture: apps/web/data/write-offs.json (${wo.records.length} WO records)`);
  lines.push(`-- Produces: ${jobPayloads.length} RawRooflinkJob, ${lineItems.length} RawRooflinkLineItems`);
  lines.push('');
  lines.push('BEGIN;');
  lines.push('');

  // Wipe in FK-safe order. (Also done by Playwright global-setup; this
  // belt-and-braces makes the seed file self-sufficient.)
  lines.push('-- Wipe (FK-safe order)');
  for (const t of [
    'PendingRuleSend',
    'RuleEvaluationState',
    'AutomationRule',
    'AuditLog',
    'Briefing',
    'SendLog',
    'Schedule',
    'FailureNotificationSetting',
    'RawRooflinkLineItems',
    'RawRooflinkJob',
    'BackfillRun',
    'BackfillSchedule',
    '"User"',
    '"Tenant"',
  ]) {
    const quoted = t.startsWith('"') ? t : `"${t}"`;
    lines.push(`DELETE FROM ${quoted};`);
  }
  lines.push('');

  // ── Tenant ───────────────────────────────────────────────────────────
  lines.push('-- Tenant (id matches DEFAULT_TEST_USER.tenantId in tests/e2e/_helpers/auth.ts)');
  lines.push(
    `INSERT INTO "Tenant" (id, name, slug, "briefingTimeLocal", "briefingTimezone") VALUES (${TENANT_ID}, 'Priority Roofs · Test', 'priority-roofs-test', '07:00', 'America/Chicago');`,
  );
  lines.push('');

  // ── User ─────────────────────────────────────────────────────────────
  lines.push('-- User (id + email match DEFAULT_TEST_USER in tests/e2e/_helpers/auth.ts)');
  lines.push(
    `INSERT INTO "User" (id, "tenantId", email, name, role) VALUES (${USER_ID}, ${TENANT_ID}, ${sqlString(USER_EMAIL)}, 'Test User', 'member');`,
  );
  lines.push('');

  // ── BackfillRun (jobs source) ─────────────────────────────────────────
  lines.push('-- BackfillRun: jobs source, promoted full sync');
  lines.push(
    `INSERT INTO "BackfillRun" (id, "tenantId", source, status, mode, promoted, "itemsProcessed", "itemsTotal", "startedAt", "finishedAt") VALUES (${JOBS_RUN_ID}, ${TENANT_ID}, 'rooflink_jobs', 'completed', 'full', true, ${jobPayloads.length}, ${jobPayloads.length}, '${ar.generatedAt}'::timestamp, '${ar.generatedAt}'::timestamp);`,
  );
  lines.push('');

  // ── BackfillRun (lineitems source) ────────────────────────────────────
  lines.push('-- BackfillRun: lineitems source, promoted full sync');
  lines.push(
    `INSERT INTO "BackfillRun" (id, "tenantId", source, status, mode, promoted, "itemsProcessed", "itemsTotal", "startedAt", "finishedAt") VALUES (${LINEITEMS_RUN_ID}, ${TENANT_ID}, 'rooflink_lineitems', 'completed', 'full', true, ${lineItems.length}, ${lineItems.length}, '${wo.generatedAt}'::timestamp, '${wo.generatedAt}'::timestamp);`,
  );
  lines.push('');

  // ── RawRooflinkJob ───────────────────────────────────────────────────
  lines.push(`-- RawRooflinkJob (${jobPayloads.length} rows)`);
  for (const job of jobPayloads) {
    lines.push(
      `INSERT INTO "RawRooflinkJob" ("rooflinkId", "dataVersion", payload, "fetchedAt") VALUES (${sqlString(String(job.id))}, ${JOBS_RUN_ID}, ${sqlJsonb(job)}, '${ar.generatedAt}'::timestamp);`,
    );
  }
  lines.push('');

  // ── RawRooflinkLineItems ─────────────────────────────────────────────
  lines.push(`-- RawRooflinkLineItems (${lineItems.length} rows)`);
  for (const li of lineItems) {
    lines.push(
      `INSERT INTO "RawRooflinkLineItems" ("estimateId", "dataVersion", payload, "fetchedAt") VALUES (${sqlString(String(li.estimateId))}, ${LINEITEMS_RUN_ID}, ${sqlJsonb(li.payload)}, '${wo.generatedAt}'::timestamp);`,
    );
  }
  lines.push('');

  // ── Advance sequences ─────────────────────────────────────────────────
  lines.push('-- Advance id sequences past seeded values so future INSERTs don\'t collide');
  lines.push(`SELECT setval(pg_get_serial_sequence('"Tenant"', 'id'), ${TENANT_ID}, true);`);
  lines.push(`SELECT setval(pg_get_serial_sequence('"User"', 'id'), ${USER_ID}, true);`);
  lines.push(`SELECT setval(pg_get_serial_sequence('"BackfillRun"', 'id'), ${maxBackfillId}, true);`);
  lines.push('');

  lines.push('COMMIT;');
  lines.push('');
  lines.push('-- LiveJob refresh happens in setup-vera-test.sh after this seed loads.');
  lines.push('');

  // ── Write file ───────────────────────────────────────────────────────
  mkdirSync(dirname(OUT_FILE), { recursive: true });
  writeFileSync(OUT_FILE, lines.join('\n'));
  console.log(`[seed] wrote ${OUT_FILE}`);
  const sizeKB = Math.round(Buffer.byteLength(lines.join('\n'), 'utf8') / 1024);
  console.log(`[seed] file size: ${sizeKB} KB`);
}

main();
