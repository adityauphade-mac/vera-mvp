import { test } from '@playwright/test';

test('audit: scheduler default state', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1300 });
  await page.goto('/dashboard/scheduler');
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(300);
  await page.screenshot({
    path: 'test-results/audit-scheduler-default.png',
    fullPage: true,
  });
});

test('audit: scheduler weekly row expanded', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1300 });
  await page.goto('/dashboard/scheduler');
  await page.waitForLoadState('networkidle');
  // Toggle weekly on so the active state is captured
  await page.locator('button[role="switch"][aria-label*="Weekly"]').click();
  await page.waitForTimeout(200);
  await page.screenshot({
    path: 'test-results/audit-scheduler-weekly.png',
    fullPage: true,
  });
});

test('audit: day-of-week dropdown open', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1100 });
  await page.goto('/dashboard/scheduler');
  await page.waitForLoadState('networkidle');
  await page.getByRole('combobox', { name: 'Day of week' }).click();
  await page.waitForTimeout(250);
  await page.screenshot({
    path: 'test-results/audit-day-of-week-dropdown.png',
    fullPage: false,
  });
});

test('audit: schedule-disabled tooltip', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1100 });
  await page.goto('/dashboard/scheduler');
  await page.waitForLoadState('networkidle');
  // Disabled button — hover the wrapping span which is what carries the tooltip listener.
  const wrapper = page.locator('span:has(button:disabled)').first();
  await wrapper.hover({ force: true });
  await page.waitForTimeout(500);
  await page.screenshot({
    path: 'test-results/audit-schedule-tooltip.png',
    fullPage: false,
  });
});
