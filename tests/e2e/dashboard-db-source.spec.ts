import { expect, test } from '@playwright/test';
import { Client } from 'pg';
import { signInAs } from './_helpers/auth';

/**
 * Verifies the DB-backed data path end-to-end:
 *   - Seed a `RawRooflinkJob` row attached to a promoted `BackfillRun`.
 *   - Hit `/api/jobs/aging` with the flag on.
 *   - Confirm the fixture job appears in the response.
 *
 * The dev server has to be started with `USE_DB_DATA_SOURCE=1` for this spec
 * to be meaningful — otherwise the API serves from the bundled JSON snapshot
 * and the seeded row is invisible. By default the spec self-skips so the
 * suite stays green on the JSON path.
 *
 * Run shape:
 *   USE_DB_DATA_SOURCE=1 pnpm --filter @vera/web start &  # in one terminal
 *   PLAYWRIGHT_BASE_URL=http://localhost:3000 \
 *     pnpm exec playwright test tests/e2e/dashboard-db-source.spec.ts
 */

const FIXTURE_JOB_ID = 999_999_001;
const FIXTURE_ADDRESS = '999 DB Cutover Lane';
const TEN_DAYS_AGO = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000)
  .toISOString()
  .slice(0, 10);

function dbUrl(): string {
  const v = process.env.DATABASE_URL ?? process.env.POSTGRES_URL;
  if (!v) throw new Error('DATABASE_URL or POSTGRES_URL must be set for this spec.');
  return v.replace(/^"|"$/g, '');
}

function fixturePayload(): Record<string, unknown> {
  return {
    id: FIXTURE_JOB_ID,
    address: FIXTURE_ADDRESS,
    full_address: FIXTURE_ADDRESS,
    city: 'Dallas',
    state: 'TX',
    region: { id: 1, name: 'Dallas', color: '#888888' },
    rep: {
      id: 42,
      full_name: 'Db-Cutover Rep',
      email: 'cutover@example.com',
      color: '#abcabc',
    },
    customer: { name: 'Cutover Customer' },
    job_type: 'Insurance',
    lead_status: { label: 'Sold' },
    lead_source: { name: 'Insurance' },
    date_completed: TEN_DAYS_AGO,
    date_last_edited: TEN_DAYS_AGO,
    date_signed: TEN_DAYS_AGO,
    primary_estimate: {
      id: 555_001,
      balance: 12_345.67,
      gt_price: 20_000,
      payments: 7_654.33,
      commissions: 0,
      is_archived: false,
    },
    exclude_from_qb: false,
    warranty_voided: false,
  };
}

test.describe('Dashboard DB-source path', () => {
  test.skip(
    process.env.USE_DB_DATA_SOURCE !== '1',
    'Set USE_DB_DATA_SOURCE=1 on the server to run this spec.',
  );

  let client: Client;
  let runId: number;

  test.beforeAll(async () => {
    client = new Client({ connectionString: dbUrl() });
    await client.connect();

    // Ensure the demo tenant exists (the global setup wipes Backfill* but
    // leaves Tenant alone; if it's missing for some reason, create it).
    await client.query(
      `INSERT INTO "Tenant" (id, slug, name, "createdAt")
       VALUES (1, 'priority-roofs', 'Priority Roofs', NOW())
       ON CONFLICT (id) DO NOTHING`,
    );

    // Create a promoted BackfillRun for rooflink_jobs and attach our fixture.
    const runRes = await client.query<{ id: number }>(
      `INSERT INTO "BackfillRun"
         ("tenantId", source, status, mode, promoted, "startedAt", "finishedAt", "itemsProcessed")
       VALUES (1, 'rooflink_jobs', 'completed', 'full', true, NOW(), NOW(), 1)
       RETURNING id`,
    );
    runId = runRes.rows[0]!.id;

    await client.query(
      `INSERT INTO "RawRooflinkJob"
         ("rooflinkId", "dataVersion", payload, "fetchedAt")
       VALUES ($1, $2, $3, NOW())`,
      [String(FIXTURE_JOB_ID), runId, fixturePayload()],
    );
  });

  test.afterAll(async () => {
    if (!client) return;
    await client.query(`DELETE FROM "RawRooflinkJob" WHERE "dataVersion" = $1`, [runId]);
    await client.query(`DELETE FROM "BackfillRun" WHERE id = $1`, [runId]);
    await client.end();
  });

  test('/api/jobs/aging surfaces the seeded job from the DB snapshot', async ({
    browser,
  }) => {
    const context = await browser.newContext();
    await signInAs(context);
    const res = await context.request.get('/api/jobs/aging');
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(Array.isArray(body.jobs)).toBe(true);
    const seeded = body.jobs.find((j: { id: number }) => j.id === FIXTURE_JOB_ID);
    expect(seeded, 'seeded fixture job should appear in DB-path response').toBeTruthy();
    expect(seeded.address).toBe(FIXTURE_ADDRESS);
    expect(seeded.balance).toBeCloseTo(12_345.67, 2);
  });

  test('asOf reflects request-time "now", not the pinned May 2026 date', async ({
    browser,
  }) => {
    const context = await browser.newContext();
    await signInAs(context);
    const res = await context.request.get('/api/jobs/aging');
    const body = await res.json();
    // JSON path's asOf is locked to 2026-05-05; DB path uses new Date().
    // Whatever month "now" is, it should not be May 5, 2026 unless the
    // calendar genuinely is there.
    expect(body.asOf).toBeTruthy();
    expect(typeof body.asOf).toBe('string');
    const diffMs = Math.abs(Date.now() - new Date(body.asOf).getTime());
    // The DB path stamps asOf at request time; allow 5 minutes of skew.
    expect(diffMs).toBeLessThan(5 * 60 * 1000);
  });
});
