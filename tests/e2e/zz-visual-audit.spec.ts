import { expect, test } from '@playwright/test';

const ROUTES = [
  { path: '/', name: 'landing' },
  { path: '/dashboard', name: 'dashboard-overview' },
  { path: '/dashboard/aging', name: 'aging' },
  { path: '/dashboard/aging?bucket=60-plus-past', name: 'aging-filtered' },
  { path: '/dashboard/milestones', name: 'milestones' },
  { path: '/dashboard/follow-ups', name: 'follow-ups' },
  { path: '/dashboard/follow-ups?tab=queue', name: 'follow-ups-queue' },
  { path: '/dashboard/rep-report', name: 'rep-report' },
  { path: '/dashboard/rep-report?sort=heat', name: 'rep-report-heat' },
  { path: '/dashboard/reconciliation', name: 'reconciliation' },
  { path: '/dashboard/design', name: 'design-system' },
];

test.describe.configure({ mode: 'serial' });

for (const route of ROUTES) {
  test(`audit ${route.name}`, async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(route.path, { waitUntil: 'networkidle' });
    // Wait for entrance animations to finish (delays up to 240ms + 360ms duration).
    await page.waitForTimeout(800);

    // Snapshot file for review
    await page.screenshot({
      path: `tests/e2e/audit-screens/${route.name}.png`,
      fullPage: true,
    });

    // Inspect design tokens being applied to body
    const bodyStyle = await page.evaluate(() => {
      const cs = window.getComputedStyle(document.body);
      return {
        backgroundColor: cs.backgroundColor,
        color: cs.color,
        fontFamily: cs.fontFamily,
      };
    });

    const headingFont = await page.evaluate(() => {
      const h = document.querySelector('h1');
      return h ? window.getComputedStyle(h).fontFamily : null;
    });

    // Annotate the test output for review
    test.info().annotations.push({
      type: 'audit',
      description: JSON.stringify({ route: route.path, bodyStyle, headingFont }, null, 2),
    });

    // Hard checks: warm parchment background + warm-brown text
    expect(bodyStyle.backgroundColor).toBe('rgb(245, 239, 230)');
    expect(bodyStyle.color).toBe('rgb(31, 27, 22)');

    // No console errors
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    expect(errors).toEqual([]);
  });
}

test('chat panel audit', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/dashboard', { waitUntil: 'networkidle' });

  const trigger = page.getByRole('button', { name: /Ask Vera/i });
  await trigger.click();

  // Wait for chat panel to be visible
  await expect(
    page.getByRole('complementary', { name: /Chat with Vera/i }),
  ).toBeVisible();

  await page.screenshot({
    path: 'tests/e2e/audit-screens/chat-panel-open.png',
    fullPage: false,
  });
});
