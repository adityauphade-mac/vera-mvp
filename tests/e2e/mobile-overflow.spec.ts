import { expect, test } from '@playwright/test';
import { signInAs } from './_helpers/auth';

/**
 * Mobile overflow regression. At 375px viewport width every route must
 * keep its document scrollWidth within the viewport — otherwise the page
 * scrolls horizontally, which is the symptom of a mobile-broken layout.
 */

test.beforeEach(async ({ context }) => {
  await signInAs(context);
});

const ROUTES = [
  '/',
  '/docs',
  '/design',
  '/dashboard',
  '/dashboard/aging',
  '/dashboard/follow-ups',
  '/dashboard/milestones',
  '/dashboard/reconciliation',
  '/dashboard/rep-leaderboard',
  '/dashboard/scheduler',
];

for (const path of ROUTES) {
  test(`mobile · no horizontal page overflow at 375px · ${path}`, async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 900 });
    await page.goto(path, { waitUntil: 'load' });
    await page.waitForTimeout(400);
    const dims = await page.evaluate(() => ({
      docW: document.documentElement.scrollWidth,
      viewW: window.innerWidth,
    }));
    expect(dims.docW, `document.scrollWidth must not exceed viewport`).toBeLessThanOrEqual(
      dims.viewW,
    );
  });
}
