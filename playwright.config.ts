import { defineConfig, devices } from '@playwright/test';

// PORT comes from the env so the test suite can listen on a different
// port than a developer's `pnpm dev` server. Conventional split:
//   - dev server: 3000 (the `pnpm dev` default)
//   - test server: 3001 (set by `scripts/test-e2e.sh`)
// Setting PORT here also propagates to the spawned `next start` child
// because Playwright's webServer command inherits process.env.
const PORT = parseInt(process.env.PORT ?? '3000', 10);
const BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? `http://localhost:${PORT}`;

export default defineConfig({
  testDir: './tests/e2e',
  globalSetup: './tests/e2e/_helpers/global-setup.ts',
  // The default run covers app-level regressions only. Excludes:
  //   _audit-* / _debug-*   ad-hoc audit scripts (screenshots, debug spelunking)
  //   prod-*                pointed at PLAYWRIGHT_PROD_URL — opt-in only
  //   chat-live             real /api/chat — gated behind RUN_LIVE_AI
  // Run those manually via `playwright test <file>` when you actually want them.
  testIgnore: [
    '**/_audit-*.spec.ts',
    '**/_debug-*.spec.ts',
    '**/prod-*.spec.ts',
    '**/chat-live.spec.ts',
  ],
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  // CI gets 2 retries; local gets 1 to absorb the occasional DB-shared
  // flake (briefing-chip-overflow under high parallel load).
  retries: process.env.CI ? 2 : 1,
  // CI runs serially. Locally we cap at 2 — under heavier parallelism the
  // shared dev DB can keep some tests in `networkidle` long enough that the
  // layout hasn't fully settled when we measure scrollWidth.
  workers: process.env.CI ? 1 : 2,
  reporter: 'list',
  use: {
    baseURL: BASE_URL,
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: process.env.PLAYWRIGHT_BASE_URL
    ? undefined
    : {
        command: 'pnpm --filter @vera/web start',
        url: `http://localhost:${PORT}`,
        reuseExistingServer: !process.env.CI,
        timeout: 120_000,
      },
});
