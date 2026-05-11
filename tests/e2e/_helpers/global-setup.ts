import { execSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Playwright global setup. Runs once before the suite.
 *
 * - Wipes the `Briefing` table so spec assertions about State-A vs State-C
 *   are deterministic.
 * - Wipes the `Schedule` table so scheduler specs start from a known empty
 *   state (the natural-key unique index means a stale row from a prior run
 *   would block PUTs that expect to be the first write).
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

  try {
    execSync(
      `pnpm --filter @vera/web exec prisma db execute --schema prisma/schema.prisma --stdin`,
      {
        // SendLog.scheduleId is ON DELETE SET NULL, so historical send rows
        // survive the Schedule wipe with their tenantId/cadence/recipient
        // intact — only the FK back-reference is nulled.
        input: 'DELETE FROM "Briefing";\nDELETE FROM "Schedule";\n',
        env: { ...process.env, DATABASE_URL: dbUrl },
        stdio: ['pipe', 'ignore', 'inherit'],
      },
    );
    // eslint-disable-next-line no-console
    console.log('[playwright] cleared Briefing and Schedule tables');
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
