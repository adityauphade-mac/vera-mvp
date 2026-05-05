import { expect, test } from '@playwright/test';

test.describe('Design system preview', () => {
  test('renders every Vera component', async ({ page }) => {
    await page.goto('/dashboard/design');

    await expect(page.getByRole('heading', { name: /Vera, in pieces/i })).toBeVisible();

    // Heat score badges across all four bands.
    for (const label of ['Cool', 'Warm', 'Hot', 'Critical']) {
      await expect(page.getByText(label, { exact: false }).first()).toBeVisible();
    }

    // Aging buckets.
    await expect(page.getByText('Within terms', { exact: true })).toBeVisible();
    await expect(page.getByText('60+ past', { exact: true })).toBeVisible();

    // Vera quote.
    await expect(page.getByText(/I.m watching three jobs/i)).toBeVisible();
  });
});
