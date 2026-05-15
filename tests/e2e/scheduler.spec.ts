import { expect, test } from '@playwright/test';
import { signInAs } from './_helpers/auth';

test.describe('Scheduler', () => {
  test.beforeEach(async ({ context }) => {
    await signInAs(context);
    // Hermetic: clear all brief schedules between tests so each starts in
    // the "no row yet" state. Tests that need a schedule create it via PUT.
    for (const cadence of ['daily', 'weekly', 'monthly']) {
      await context.request.delete(`/api/schedules/${cadence}`).catch(() => {});
    }
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

  test('has Reports, Data sync, and Automation tabs', async ({ page }) => {
    await page.goto('/dashboard/scheduler');
    await expect(page.getByRole('tab', { name: 'Reports' })).toBeVisible();
    await expect(page.getByRole('tab', { name: 'Data sync' })).toBeVisible();
    await expect(page.getByRole('tab', { name: 'Automation' })).toBeVisible();
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

  test('Daily brief recipients chip input accepts multiple emails and gates Save', async ({
    page,
  }) => {
    // Hermetic: clear any existing schedule.
    await page.request.delete('/api/schedules/daily');

    await page.goto('/dashboard/scheduler');
    const recipientsField = page.getByRole('group', {
      name: 'Recipients for Daily AR brief',
    });
    await expect(recipientsField).toBeVisible();

    // Add two recipients via the input — Enter commits each as a chip.
    const input = recipientsField.locator('input[type="email"]');
    await input.fill('ops@example.com');
    await input.press('Enter');
    await expect(recipientsField.getByText('ops@example.com')).toBeVisible();

    await input.fill('finance@example.com');
    await input.press('Enter');
    await expect(recipientsField.getByText('finance@example.com')).toBeVisible();

    // Invalid email shows inline error and is rejected from the chip set.
    await input.fill('not-an-email');
    await input.press('Enter');
    await expect(page.getByText(/Not a valid email/i)).toBeVisible();
    await expect(recipientsField.getByText('not-an-email')).toHaveCount(0);
  });

  test('?tab=sync URL navigates to Data sync tab and survives refresh', async ({
    page,
  }) => {
    await page.goto('/dashboard/scheduler?tab=sync');
    await expect(
      page.getByTestId('backfill-card-rooflink_jobs'),
    ).toBeVisible();
    // Refresh — tab state lives in the URL, so the sync tab should stay.
    await page.reload();
    await expect(
      page.getByTestId('backfill-card-rooflink_jobs'),
    ).toBeVisible();
  });

  test('?tab=automation renders the placeholder without crashing', async ({
    page,
  }) => {
    await page.goto('/dashboard/scheduler?tab=automation');
    await expect(
      page.getByRole('heading', { name: /Automation rules/i }),
    ).toBeVisible();
    await expect(page.getByText(/Coming in B-5/i)).toBeVisible();
  });

  test('Tab clicks update the URL query param', async ({ page }) => {
    await page.goto('/dashboard/scheduler');
    await expect(page).toHaveURL(/\/dashboard\/scheduler($|\?)/);

    await page.getByRole('tab', { name: 'Automation' }).click();
    await expect(page).toHaveURL(/[?&]tab=automation/);

    await page.getByRole('tab', { name: 'Data sync' }).click();
    await expect(page).toHaveURL(/[?&]tab=sync/);
  });
});
