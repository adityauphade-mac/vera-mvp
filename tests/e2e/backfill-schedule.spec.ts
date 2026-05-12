import { expect, test } from '@playwright/test';
import { signInAs } from './_helpers/auth';

/**
 * UI happy path for the new "Data sync" section of /dashboard/scheduler.
 * Backfill UI hits real API routes against the local DB — see Playwright
 * global-setup which wipes Schedule/Briefing per run.
 */

test.describe('Backfill scheduling UI', () => {
  test.beforeEach(async ({ context }) => {
    await signInAs(context);
    // Hermetic: wipe any schedule a prior spec in this run left behind.
    // The 404 is fine — means no schedule exists.
    await context.request.delete('/api/backfills/rooflink_jobs/schedule');
    await context.request.delete('/api/backfills/rooflink_lineitems/schedule');
  });

  async function openDataSyncTab(page: import('@playwright/test').Page) {
    await page.goto('/dashboard/scheduler');
    await page.getByRole('tab', { name: 'Data sync' }).click();
  }

  test('Data sync tab renders both source cards', async ({ page }) => {
    await openDataSyncTab(page);
    await expect(page.getByTestId('data-sync-section')).toBeVisible();
    await expect(page.getByTestId('backfill-card-rooflink_jobs')).toBeVisible();
    await expect(page.getByTestId('backfill-card-rooflink_lineitems')).toBeVisible();
  });

  test('each card shows a Run-now and Schedule button', async ({ page }) => {
    await openDataSyncTab(page);
    const jobsCard = page.getByTestId('backfill-card-rooflink_jobs');
    await expect(
      jobsCard.getByRole('button', { name: /^Run (now|sync)$/ }),
    ).toBeVisible();
    await expect(
      jobsCard.getByRole('button', { name: /^Schedule$/ }),
    ).toBeVisible();
  });

  test('initial status pill is "Not scheduled" before any schedule', async ({
    page,
  }) => {
    await openDataSyncTab(page);
    const pill = page.getByTestId('status-pill-rooflink_jobs');
    await expect(pill).toContainText(/Not scheduled/i);
  });
});
