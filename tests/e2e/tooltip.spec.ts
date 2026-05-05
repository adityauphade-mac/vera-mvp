import { expect, test } from '@playwright/test';

test.describe('Tooltips', () => {
  test('aging chip in a table row shows tooltip via portal', async ({ page }) => {
    await page.goto('/dashboard/aging?bucket=60-plus-past');
    await page.waitForTimeout(800);

    // Hover the first aging chip inside a table cell.
    const chip = page.locator('table span').filter({ hasText: /^60\+ past$/ }).first();
    await chip.hover();

    // Portal renders to body — getByRole tooltip should find it.
    await expect(page.getByRole('tooltip')).toBeVisible();
    await expect(page.getByRole('tooltip')).toContainText(/60\+ days past terms/);
  });

  test('heat meter compact shows breakdown tooltip', async ({ page }) => {
    await page.goto('/dashboard/aging?bucket=60-plus-past');
    await page.waitForTimeout(800);

    // The heat meter wrapper has both the score number, the bar, and 'CRITICAL' label.
    const heatLabel = page.locator('table span').filter({ hasText: /^CRITICAL$/i }).first();
    await heatLabel.hover();

    await expect(page.getByRole('tooltip')).toBeVisible();
    await expect(page.getByRole('tooltip')).toContainText(/Heat/);
  });
});
