import { expect, test } from '@playwright/test';

test.describe('Design system preview', () => {
  test('renders every Vera component', async ({ page }) => {
    await page.goto('/dashboard/design');

    await expect(page.getByRole('heading', { name: /Vera, in pieces/i })).toBeVisible();

    // Heat meter labels across all four bands appear.
    for (const label of ['COOL', 'WARM', 'HOT', 'CRITICAL']) {
      await expect(page.getByText(label, { exact: false }).first()).toBeVisible();
    }

    // Aging buckets.
    await expect(page.getByText('Within terms', { exact: true }).first()).toBeVisible();
    await expect(page.getByText('60+ past', { exact: true }).first()).toBeVisible();

    // Vera quote.
    await expect(page.getByText(/I.m watching three jobs/i)).toBeVisible();
  });
});
