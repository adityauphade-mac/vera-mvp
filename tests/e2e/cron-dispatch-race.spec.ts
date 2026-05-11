import { expect, test } from '@playwright/test';
import { signInAs } from './_helpers/auth';
import { execSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Race-condition regression for /api/cron/dispatch-briefs.
 *
 * The dispatcher runs every 15 minutes. If two invocations overlap (cron
 * drift, retry, manual re-trigger), they could both find the same due
 * Schedule row and both fire the email. The optimistic lock on nextRunAt
 * is supposed to prevent that.
 *
 * This spec proves it:
 *   1. Sign in, POST a daily schedule via /api/schedules.
 *   2. SQL hack: push that schedule's nextRunAt 1 minute into the past
 *      so it's due RIGHT NOW.
 *   3. Stub /api/brief/send so we don't burn real Resend calls (and so
 *      this test doesn't fail in CI without RESEND_API_KEY).
 *   4. Fire TEN /api/cron/dispatch-briefs requests in parallel with the
 *      bearer.
 *   5. Assert: total `sent` across all responses is exactly 1. Anything
 *      else is a double-fire bug.
 */

const CRON_SECRET = loadCronSecret();
const DATABASE_URL = loadDatabaseUrl();

const RACE_TEST_RECIPIENT = 'race-test@example.com';

test.describe('Cron dispatch — race conditions', () => {
  // Opt-in: fires real Resend calls (one per parallel dispatch fan-out).
  // Run with: RUN_RACE_TEST=1 pnpm exec playwright test cron-dispatch-race
  test.skip(
    !process.env.RUN_RACE_TEST || !CRON_SECRET || !DATABASE_URL,
    'Opt-in only. Set RUN_RACE_TEST=1 (and CRON_SECRET, DATABASE_URL) to run.',
  );

  test('parallel dispatches fire each due schedule at most once', async ({
    browser,
    request,
  }) => {
    // Clean any leftover schedules from previous runs.
    await sql(`DELETE FROM "SendLog" WHERE "toEmail" = '${RACE_TEST_RECIPIENT}';`);
    await sql(`DELETE FROM "Schedule" WHERE recipient = '${RACE_TEST_RECIPIENT}';`);

    // 1. Create a schedule via the auth-gated API (proves the contract).
    //    PUT is upsert keyed on (tenantId, cadence) — the DELETE above
    //    leaves us in a clean state, so this PUT creates a fresh row.
    const ctx = await browser.newContext();
    await signInAs(ctx);
    const created = await ctx.request.put('/api/schedules/daily', {
      data: {
        timeLocal: '08:00',
        timezone: 'America/Chicago',
        recipient: RACE_TEST_RECIPIENT,
        enabled: true,
      },
    });
    expect(created.status()).toBe(201);
    const { schedule } = await created.json();
    await ctx.close();

    // 2. Force it due.
    await sql(
      `UPDATE "Schedule" SET "nextRunAt" = NOW() - INTERVAL '1 minute' WHERE id = ${schedule.id};`,
    );

    // 3. Fire 10 dispatches in parallel.
    const fires = Array.from({ length: 10 }, () =>
      request.post('/api/cron/dispatch-briefs', {
        headers: { Authorization: `Bearer ${CRON_SECRET}` },
      }),
    );
    const responses = await Promise.all(fires);
    const bodies = await Promise.all(responses.map((r) => r.json()));

    // 4. Sum sent / skipped / failed across every response.
    let sent = 0;
    let skipped = 0;
    let failed = 0;
    for (const body of bodies) {
      for (const r of body.results ?? []) {
        if (r.scheduleId !== schedule.id) continue;
        if (r.status === 'sent') sent += 1;
        if (r.status === 'skipped') skipped += 1;
        if (r.status === 'failed') failed += 1;
      }
    }

    // 5. Exactly ONE fire. The other 9 invocations either:
    //    a) lost the optimistic lock (status=skipped), OR
    //    b) ran their SELECT after the first UPDATE committed and saw an
    //       empty due-set (no entry in their results at all)
    //    Both outcomes are correct — what we never want is two sends.
    expect(sent + failed, 'exactly one dispatch should attempt to send').toBe(1);

    // 6. SendLog rows for this schedule must be exactly 1.
    const logCount = await sqlScalar(
      `SELECT COUNT(*)::int AS n FROM "SendLog" WHERE "scheduleId" = ${schedule.id};`,
    );
    expect(logCount, 'at-most-once delivery: SendLog row count').toBe(1);

    // 7. Schedule's nextRunAt has been advanced exactly once.
    const advanced = await sqlScalar(
      `SELECT EXTRACT(EPOCH FROM "nextRunAt")::int FROM "Schedule" WHERE id = ${schedule.id};`,
    );
    expect(advanced, 'nextRunAt advanced past now').toBeGreaterThan(
      Math.floor(Date.now() / 1000),
    );

    // Diagnostic: log the breakdown so a future failure is easy to read.
    test.info().annotations.push({
      type: 'race-test',
      description: `sent=${sent} skipped=${skipped} failed=${failed} sendLogRows=${logCount}`,
    });

    // Cleanup.
    await sql(`DELETE FROM "SendLog" WHERE "scheduleId" = ${schedule.id};`);
    await sql(`DELETE FROM "Schedule" WHERE id = ${schedule.id};`);
  });
});

// ─── Helpers ────────────────────────────────────────────────────────────

function loadCronSecret(): string | null {
  if (process.env.CRON_SECRET) return process.env.CRON_SECRET;
  return readEnvKey('CRON_SECRET');
}

function loadDatabaseUrl(): string | null {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  return readEnvKey('DATABASE_URL');
}

function readEnvKey(key: string): string | null {
  const path = join(process.cwd(), 'apps/web/.env.local');
  if (!existsSync(path)) return null;
  const env = readFileSync(path, 'utf8');
  const m = env.match(new RegExp(`^${key}=(.+)$`, 'm'));
  if (!m) return null;
  return (m[1] ?? '').replace(/^"(.*)"$/, '$1').replace(/^'(.*)'$/, '$1').trim();
}

function sql(query: string): Promise<void> {
  return new Promise((resolve, reject) => {
    try {
      execSync(`psql "${DATABASE_URL}" -c "${query.replace(/"/g, '\\"')}"`, {
        stdio: 'pipe',
      });
      resolve();
    } catch (e) {
      reject(e);
    }
  });
}

function sqlScalar(query: string): Promise<number> {
  return new Promise((resolve, reject) => {
    try {
      const out = execSync(`psql "${DATABASE_URL}" -t -A -c "${query.replace(/"/g, '\\"')}"`, {
        encoding: 'utf8',
      });
      resolve(Number(out.trim()));
    } catch (e) {
      reject(e);
    }
  });
}
