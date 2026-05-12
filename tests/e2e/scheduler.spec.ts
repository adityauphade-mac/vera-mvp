import { expect, test } from '@playwright/test';
import { signInAs } from './_helpers/auth';

test.describe('Scheduler', () => {
  test.beforeEach(async ({ context }) => {
    await signInAs(context);
  });

  test('renders header and three reports', async ({ page }) => {
    await page.goto('/dashboard/scheduler');
    // Header
    await expect(
      page.getByRole('heading', { name: /When Vera reports/i }),
    ).toBeVisible();
    // Three report cards
    await expect(page.getByText('Daily AR brief', { exact: true })).toBeVisible();
    await expect(page.getByText('Weekly summary', { exact: true })).toBeVisible();
    await expect(page.getByText('Monthly close', { exact: true })).toBeVisible();
    // The "preview" banner is gone — schedules are real now.
    await expect(
      page.getByText(/Preview of the scheduling experience/i),
    ).toHaveCount(0);
  });

  test('has Reports and Data sync tabs (Highlights is hidden — v2)', async ({
    page,
  }) => {
    await page.goto('/dashboard/scheduler');
    await expect(page.getByRole('tab', { name: 'Reports' })).toBeVisible();
    await expect(page.getByRole('tab', { name: 'Data sync' })).toBeVisible();
    // Highlights section is intentionally hidden until the diff engine ships.
    await expect(
      page.getByRole('heading', { name: /What gets highlighted/i }),
    ).toHaveCount(0);
  });

  test('Send now is disabled until a valid recipient is entered', async ({
    page,
  }) => {
    await page.goto('/dashboard/scheduler');
    // Reports is the default tab — its three rows have Send now buttons.
    const sendButtons = page.getByRole('button', { name: /Send now/i });
    await expect(sendButtons.first()).toBeDisabled();
  });

  test('Sidebar nav contains the Scheduler link', async ({ page }) => {
    await page.goto('/dashboard');
    await expect(page.getByRole('link', { name: /Scheduler/i })).toBeVisible();
  });

  test('default tab is Reports — three Schedule buttons visible', async ({
    page,
  }) => {
    await page.goto('/dashboard/scheduler');
    const reportsPanel = page.getByRole('tabpanel', { name: /^Reports$/ });
    const scheduleButtons = reportsPanel.getByRole('button', { name: /^Schedule$/ });
    await expect(scheduleButtons).toHaveCount(3);
    for (let i = 0; i < 3; i++) {
      await expect(scheduleButtons.nth(i)).toBeDisabled();
    }
  });

  test('Data sync tab reveals both backfill cards on click', async ({ page }) => {
    await page.goto('/dashboard/scheduler');
    // Cards are NOT in the DOM until the tab is selected.
    await expect(page.getByTestId('backfill-card-rooflink_jobs')).toHaveCount(0);
    await page.getByRole('tab', { name: 'Data sync' }).click();
    await expect(page.getByTestId('backfill-card-rooflink_jobs')).toBeVisible();
    await expect(page.getByTestId('backfill-card-rooflink_lineitems')).toBeVisible();
  });
});
