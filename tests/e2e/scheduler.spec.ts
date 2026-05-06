import { expect, test } from '@playwright/test';

test.describe('Scheduler', () => {
  test('renders the preview banner, header, and three reports', async ({ page }) => {
    await page.goto('/dashboard/scheduler');
    // Banner
    await expect(
      page.getByText(/Preview of the scheduling experience/i),
    ).toBeVisible();
    // Header
    await expect(
      page.getByRole('heading', { name: /When Vera reports/i }),
    ).toBeVisible();
    // Three report cards
    await expect(page.getByText('Daily AR brief', { exact: true })).toBeVisible();
    await expect(page.getByText('Weekly summary', { exact: true })).toBeVisible();
    await expect(page.getByText('Monthly close', { exact: true })).toBeVisible();
  });

  test('shows the highlights section with all six toggles', async ({ page }) => {
    await page.goto('/dashboard/scheduler');
    await expect(
      page.getByRole('heading', { name: /What gets highlighted/i }),
    ).toBeVisible();
    for (const label of [
      'Job moved between aging buckets',
      'Heat score band changed',
      'Job category changed',
      'New anomaly flagged',
      'Job paid off',
      'New rep assigned',
    ]) {
      await expect(page.getByText(label, { exact: true })).toBeVisible();
    }
  });

  test('Send now is disabled until a valid recipient is entered', async ({
    page,
  }) => {
    await page.goto('/dashboard/scheduler');
    // Each report has a Send now button — the daily one specifically.
    const sendButtons = page.getByRole('button', { name: /Send now/i });
    // Without recipient, button is disabled
    await expect(sendButtons.first()).toBeDisabled();
  });

  test('Sidebar nav contains the Scheduler link', async ({ page }) => {
    await page.goto('/dashboard');
    await expect(page.getByRole('link', { name: /Scheduler/i })).toBeVisible();
  });

  test('each report row has a disabled Schedule button next to Send now', async ({
    page,
  }) => {
    await page.goto('/dashboard/scheduler');
    const scheduleButtons = page.getByRole('button', { name: /^Schedule$/ });
    await expect(scheduleButtons).toHaveCount(3);
    // All Schedule buttons are disabled (preview only)
    for (let i = 0; i < 3; i++) {
      await expect(scheduleButtons.nth(i)).toBeDisabled();
    }
  });
});
