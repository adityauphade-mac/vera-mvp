import { execSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import pg from 'pg';

/**
 * Playwright global setup. Runs once before the suite.
 *
 * - Refuses to run against a DB with promoted BackfillRun rows (production-
 *   shape data canary). Override with PLAYWRIGHT_ALLOW_PROD_DATA_WIPE=1.
 * - Wipes the `Briefing` table so spec assertions about State-A vs State-C
 *   are deterministic.
 * - Wipes the `Schedule` table so scheduler specs start from a known empty
 *   state (the natural-key unique index means a stale row from a prior run
 *   would block PUTs that expect to be the first write).
 * - Wipes the `AuditLog`, `Backfill*`, and `Raw*` tables so backfill / audit
 *   specs can assert on row counts deterministically.
 *
 * No-op if DATABASE_URL is unset (DB-less local runs of public-route specs).
 */
export default async function globalSetup(): Promise<void> {
  const dbUrl = resolveDatabaseUrl();
  if (!dbUrl) {
    // eslint-disable-next-line no-console
    console.warn('[playwright] DATABASE_URL not found — skipping DB reset');
    return;
  }

  // Safety guard — refuse to wipe a DB that contains production-shape data.
  // A promoted BackfillRun is the canary: tests never create promoted runs
  // (they create runs with `promoted=false`), so any promoted row means the
  // target DB has been seeded with real backfill output. If we wipe it, the
  // operator loses 100k+ rows of cached Rooflink data that takes hours to
  // re-fetch.
  //
  // This guard fires HARD (throws), so Playwright won't start. The error
  // message tells the operator to use a dedicated test DB instead. If you're
  // hitting this and you genuinely want to run tests against this DB, set
  // PLAYWRIGHT_ALLOW_PROD_DATA_WIPE=1 — but stop and read the error first.
  const probeClient = new pg.Client({ connectionString: dbUrl });
  let promotedCount = 0;
  try {
    await probeClient.connect();
    const res = await probeClient.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM "BackfillRun" WHERE promoted = true`,
    );
    promotedCount = parseInt(res.rows[0]?.n ?? '0', 10) || 0;
  } catch (e) {
    // Probe failed — either the table doesn't exist (fresh DB, nothing to
    // protect) or connectivity is broken (deleting will fail too, so no
    // safety risk). Either way, proceed.
    // eslint-disable-next-line no-console
    console.warn(
      '[playwright global-setup] promoted-row probe failed; treating as empty DB:',
      e instanceof Error ? e.message : e,
    );
  } finally {
    await probeClient.end().catch(() => undefined);
  }

  if (
    promotedCount > 0 &&
    process.env.PLAYWRIGHT_ALLOW_PROD_DATA_WIPE !== '1'
  ) {
    throw new Error(
      `[playwright global-setup] target DB has ${promotedCount} promoted BackfillRun row(s) — ` +
        `refusing to DELETE FROM Backfill*/Raw* tables. ` +
        `These tables likely contain production-shape data that hours of backfill work produced. ` +
        `Fix: run Playwright against a dedicated test DB (e.g. vera_test), not the dev DB. ` +
        `To override (DESTRUCTIVE — wipes the promoted snapshot): set PLAYWRIGHT_ALLOW_PROD_DATA_WIPE=1.`,
    );
  }

  try {
    execSync(
      `pnpm --filter @vera/web exec prisma db execute --schema prisma/schema.prisma --stdin`,
      {
        // SendLog.scheduleId is ON DELETE SET NULL, so historical send rows
        // survive the Schedule wipe with their tenantId/cadence/recipient
        // intact — only the FK back-reference is nulled.
        //
        // BackfillRun.scheduleId references BackfillSchedule — delete runs
        // before schedules so the FK doesn't block.
        input:
          'DELETE FROM "AuditLog";\n' +
          'DELETE FROM "Briefing";\n' +
          'DELETE FROM "Schedule";\n' +
          'DELETE FROM "RawRooflinkJob";\n' +
          'DELETE FROM "RawRooflinkLineItems";\n' +
          'DELETE FROM "BackfillRun";\n' +
          'DELETE FROM "BackfillSchedule";\n' +
          'DELETE FROM "FailureNotificationSetting";\n' +
          // PendingRuleSend + RuleEvaluationState cascade from AutomationRule,
          // but keep DELETE explicit so a fresh DB without rules still wipes
          // deterministically.
          'DELETE FROM "PendingRuleSend";\n' +
          'DELETE FROM "RuleEvaluationState";\n' +
          'DELETE FROM "AutomationRule";\n',
        env: { ...process.env, DATABASE_URL: dbUrl },
        stdio: ['pipe', 'ignore', 'inherit'],
      },
    );
    // eslint-disable-next-line no-console
    console.log(
      '[playwright] cleared AuditLog, Briefing, Schedule, Backfill* tables',
    );
  } catch (e) {
    // eslint-disable-next-line no-console
    console.warn('[playwright] DB reset failed — specs may be non-deterministic:', e);
  }
}

function resolveDatabaseUrl(): string | null {
  if (process.env.DATABASE_URL) return stripQuotes(process.env.DATABASE_URL);
  const envPath = join(process.cwd(), 'apps/web/.env.local');
  if (!existsSync(envPath)) return null;
  const env = readFileSync(envPath, 'utf8');
  const m = env.match(/^DATABASE_URL=(.+)$/m);
  return m ? stripQuotes(m[1].trim()) : null;
}

function stripQuotes(s: string): string {
  return s.replace(/^"(.*)"$/, '$1').replace(/^'(.*)'$/, '$1');
}
