import { expect, test } from '@playwright/test';

test.describe('Dashboard overview (Today)', () => {
  test('renders metric tiles and Vera briefing', async ({ page }) => {
    await page.goto('/dashboard');

    await expect(page.getByRole('heading', { name: /Today.s briefing/i })).toBeVisible();

    // Four metric tiles
    await expect(page.getByText('Total AR')).toBeVisible();
    await expect(page.getByText('Critical', { exact: true }).first()).toBeVisible();
    await expect(page.getByText('Hot', { exact: true }).first()).toBeVisible();
    await expect(page.getByText('Fell through')).toBeVisible();

    // Top three section
    await expect(page.getByText(/Top three I.d look at first/i)).toBeVisible();

    // Vera narrative present
    await expect(page.getByText(/Good morning/i).first()).toBeVisible();
  });

  test('sidebar nav links work', async ({ page }) => {
    await page.goto('/dashboard');

    for (const slug of ['aging', 'milestones', 'follow-ups', 'rep-report', 'reconciliation']) {
      await page.goto(`/dashboard/${slug}`);
      // Stub renders a heading; just confirm the route resolves with no error.
      await expect(page.locator('h1')).toBeVisible();
    }
  });
});
