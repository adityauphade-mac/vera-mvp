import { expect, test } from '@playwright/test';
import { signInAs } from './_helpers/auth';

/**
 * Pre-demo mobile regression sweep. Captures a full-page screenshot of every
 * route at 375px (iPhone SE / 12 mini — the tightest realistic phone) and
 * also asserts no horizontal overflow.
 *
 * Output: tests/e2e/audit-screens/regression-{name}.png
 *
 * Stubs the AI briefing API so the dashboard's State C card renders too
 * (one of the surfaces most likely to mis-wrap on phones).
 */

const PUBLIC_ROUTES = [
  { path: '/', name: 'landing' },
  { path: '/docs', name: 'docs' },
  { path: '/design', name: 'design-system' },
  { path: '/login', name: 'login' },
];

const DASHBOARD_ROUTES = [
  { path: '/dashboard', name: 'dashboard-overview' },
  { path: '/dashboard/aging', name: 'aging' },
  { path: '/dashboard/aging?buckets=60-plus-past', name: 'aging-filtered' },
  { path: '/dashboard/follow-ups', name: 'follow-ups' },
  { path: '/dashboard/follow-ups?tab=queue', name: 'follow-ups-queue' },
  { path: '/dashboard/milestones', name: 'milestones' },
  { path: '/dashboard/reconciliation', name: 'reconciliation' },
  { path: '/dashboard/rep-leaderboard', name: 'rep-leaderboard' },
  { path: '/dashboard/scheduler', name: 'scheduler' },
];

const VIEWPORT = { width: 375, height: 900 };

const MOCK_BRIEFING = {
  ok: true,
  briefing: {
    headline: 'Insurance receivables tightening — three jobs aging fast',
    bodyMd:
      "I'm watching **$48,200** across three jobs that crossed **60 days past terms** overnight. " +
      "**Mike Sanchez** has two — **Carol Whitfield's** Plano roof at heat **88** is most urgent.\n\n" +
      "No severe weather in the metro, leads are quiet. I'd nudge Mike on Whitfield this morning.",
    sources: [
      { type: 'nws', label: 'Flood Warning', detail: 'Severe', url: 'https://www.weather.gov/' },
      { type: 'nws', label: 'Special Weather Statement', detail: 'Moderate', url: 'https://www.weather.gov/' },
      { type: 'news', label: 'Roofing industry feels insurance-claim slowdown in Q1', detail: 'Roofing Contractor', url: 'https://example.com/a' },
      { type: 'news', label: 'What to Do After a Storm: A Chimney Inspection Walkthrough', detail: 'Socialmediaexplorer.com', url: 'https://example.com/b' },
    ],
    generatedAt: new Date().toISOString(),
    model: 'gpt-4o',
  },
};

test.describe('Mobile regression @ 375px', () => {
  test.beforeEach(async ({ context, page }) => {
    await signInAs(context);
    await page.route('**/api/briefings/regenerate', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(MOCK_BRIEFING),
      });
    });
  });

  for (const route of PUBLIC_ROUTES) {
    test(`public · ${route.name}`, async ({ page }) => {
      await page.setViewportSize(VIEWPORT);
      await page.goto(route.path, { waitUntil: 'load' });
      await page.waitForTimeout(600);
      await capture(page, route.name);
    });
  }

  for (const route of DASHBOARD_ROUTES) {
    test(`signed · ${route.name}`, async ({ page }) => {
      await page.setViewportSize(VIEWPORT);
      await page.goto(route.path, { waitUntil: 'load' });
      await page.waitForTimeout(600);
      await capture(page, route.name);
    });
  }

  test('signed · dashboard-overview · briefing State C (after fetch)', async ({ page }) => {
    await page.setViewportSize(VIEWPORT);
    await page.goto('/dashboard', { waitUntil: 'load' });
    await page.waitForTimeout(600);
    await page.getByRole('button', { name: /Fetch latest news/i }).click();
    await expect(page.getByText(/Today.s news, woven in/i)).toBeVisible();
    await page.waitForTimeout(300);
    await capture(page, 'dashboard-state-c');
  });

  test('signed · sidebar nav drawer open', async ({ page }) => {
    await page.setViewportSize(VIEWPORT);
    await page.goto('/dashboard', { waitUntil: 'load' });
    await page.waitForTimeout(400);
    // Mobile nav trigger — usually a hamburger icon.
    const trigger = page.getByRole('button', { name: /menu|navigation|open nav/i }).first();
    if (await trigger.isVisible().catch(() => false)) {
      await trigger.click();
      await page.waitForTimeout(300);
    }
    await capture(page, 'sidebar-drawer-open');
  });

  test('signed · chat panel open', async ({ page }) => {
    await page.setViewportSize(VIEWPORT);
    await page.goto('/dashboard', { waitUntil: 'load' });
    await page.waitForTimeout(400);
    await page.getByRole('button', { name: /Ask Me/i }).click();
    await page.waitForTimeout(300);
    await capture(page, 'chat-panel-open');
  });

  test('signed · aging row sheet open', async ({ page }) => {
    await page.setViewportSize(VIEWPORT);
    await page.goto('/dashboard/aging?buckets=60-plus-past', { waitUntil: 'load' });
    await page.waitForTimeout(800);
    const firstRow = page.locator('table tbody tr').first();
    if (await firstRow.isVisible().catch(() => false)) {
      await firstRow.click();
      await page.waitForTimeout(300);
    }
    await capture(page, 'aging-row-sheet-open');
  });
});

async function capture(page: import('@playwright/test').Page, name: string) {
  await page.screenshot({
    path: `tests/e2e/audit-screens/regression-${name}.png`,
    fullPage: true,
  });
  // Hard assertion: no horizontal page overflow.
  const dims = await page.evaluate(() => ({
    docW: document.documentElement.scrollWidth,
    viewW: window.innerWidth,
  }));
  expect(dims.docW, `${name}: document.scrollWidth must not exceed viewport`).toBeLessThanOrEqual(
    dims.viewW + 1,
  );
}
