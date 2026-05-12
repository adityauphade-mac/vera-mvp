import { expect, test } from '@playwright/test';
import { signInAs } from './_helpers/auth';

test.describe('Write-offs report', () => {
  test.beforeEach(async ({ context }) => {
    await signInAs(context);
  });

  test('renders header, narrative, and metric tiles', async ({ page }) => {
    await page.goto('/dashboard/write-offs');
    await expect(
      page.getByRole('heading', { name: /Where the money walked away/i }),
    ).toBeVisible();
    await expect(page.getByText('Total written off')).toBeVisible();
    await expect(page.getByText('Jobs with write-offs')).toBeVisible();
    await expect(page.getByText('Largest single write-off')).toBeVisible();
  });

  test('table shows at least one write-off row with US-formatted install date', async ({
    page,
  }) => {
    await page.goto('/dashboard/write-offs');
    await page.waitForTimeout(800);
    const firstRow = page.locator('table tbody tr').first();
    await expect(firstRow).toBeVisible();
    // MM/DD/YYYY cell on every row
    await expect(firstRow.locator('td').nth(2)).toContainText(/\d{2}\/\d{2}\/\d{4}/);
  });

  test('clicking a row opens the WriteOffDetailSheet with reconciliation', async ({
    page,
  }) => {
    await page.goto('/dashboard/write-offs');
    await page.waitForTimeout(800);
    await page.locator('table tbody tr').first().click();
    const sheet = page.getByRole('dialog');
    await expect(sheet).toBeVisible();
    await expect(sheet.getByRole('heading', { name: /Reconciliation/i })).toBeVisible();
    await expect(sheet.getByText(/Amount Withheld/i).first()).toBeVisible();
  });
});
