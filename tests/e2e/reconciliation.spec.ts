import { expect, test } from '@playwright/test';

test.describe('Reconciliation report', () => {
  test('renders header and Vera narrative', async ({ page }) => {
    await page.goto('/dashboard/reconciliation');
    await expect(
      page.getByRole('heading', { name: /Fell through cracks/i }),
    ).toBeVisible();
    // Vera quote should mention either a count or that nothing fell through.
    const narrative = page.locator('p.italic').first();
    await expect(narrative).toBeVisible();
  });

  test('shows the metric tiles', async ({ page }) => {
    await page.goto('/dashboard/reconciliation');
    await expect(page.getByText('Stuck jobs')).toBeVisible();
    await expect(page.getByText('Locked up')).toBeVisible();
    await expect(page.getByText('Reps affected')).toBeVisible();
    await expect(page.getByText('Oldest install')).toBeVisible();
  });
});
