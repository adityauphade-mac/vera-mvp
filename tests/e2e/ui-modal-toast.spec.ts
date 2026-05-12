import { expect, test } from '@playwright/test';
import { signInAs } from './_helpers/auth';

/**
 * Asserts the new modal-and-toast patterns work on the scheduler page.
 *
 *   - Remove triggers a styled <ConfirmDialog>, not window.confirm
 *   - Run-now triggers a sonner toast ("sync started"), not an inline banner
 *
 * Per CLAUDE.md hard rule #11 — no window.confirm/alert anywhere in the app.
 */
test.describe('Modal + toast UX (rule #11)', () => {
  test('Remove schedule opens the ConfirmDialog, Cancel closes it', async ({
    browser,
  }) => {
    const context = await browser.newContext();
    await signInAs(context);
    const page = await context.newPage();

    // Pre-create a schedule so the Remove button is rendered.
    await context.request.put('/api/backfills/rooflink_jobs/schedule', {
      data: {
        cadence: 'weekly',
        dayOfWeek: 1,
        timeLocal: '03:00',
        timezone: 'America/Chicago',
        enabled: true,
      },
    });

    await page.goto('/dashboard/scheduler');
    await page.getByRole('tab', { name: 'Data sync' }).click();
    const card = page.getByTestId('backfill-card-rooflink_jobs');
    await card.waitFor({ timeout: 10_000 });

    await card.getByRole('button', { name: /^Remove$/ }).click();

    // ConfirmDialog should appear — no native browser dialog.
    const dialog = page.getByTestId('confirm-dialog');
    await expect(dialog).toBeVisible();
    // Title is rendered in eyebrow-style uppercase (the imperative action).
    await expect(page.getByTestId('confirm-dialog-title')).toContainText(
      /Remove rooflink jobs schedule/i,
    );

    // Cancel button closes it without taking action.
    await page.getByTestId('confirm-dialog-cancel').click();
    await expect(dialog).not.toBeVisible();

    // Schedule still exists (we canceled).
    const after = await context.request.get('/api/backfills');
    const json = await after.json();
    const jobsSchedule = json.schedules.find(
      (s: { source: string }) => s.source === 'rooflink_jobs',
    );
    expect(jobsSchedule).toBeTruthy();
  });

  test('Run sync fires a sonner toast (not an inline banner)', async ({
    browser,
  }) => {
    const context = await browser.newContext();
    await signInAs(context);
    const page = await context.newPage();

    await page.goto('/dashboard/scheduler');
    await page.getByRole('tab', { name: 'Data sync' }).click();
    const card = page.getByTestId('backfill-card-rooflink_jobs');
    await card.waitFor({ timeout: 10_000 });

    await card.getByRole('button', { name: /^Run (now|sync)$/ }).click();

    // Persistent-loader toast should appear with the source name + mode.
    const toast = page
      .locator('[data-sonner-toast]')
      .filter({ hasText: /Rooflink jobs/i })
      .first();
    await expect(toast).toBeVisible({ timeout: 8_000 });

    // The inline progress block was removed — the toast is the only
    // progress UI now. Old red-banner class should never render.
    const inlineErrorBanner = card.locator('.border-heat-critical\\/40').first();
    await expect(inlineErrorBanner).toHaveCount(0);
    const inlineProgress = page.getByTestId('progress-rooflink_jobs');
    await expect(inlineProgress).toHaveCount(0);
  });

  test('Loader toast swaps to success when the run completes', async ({
    browser,
  }) => {
    const context = await browser.newContext();
    await signInAs(context);
    const page = await context.newPage();

    await page.goto('/dashboard/scheduler');
    await page.getByRole('tab', { name: 'Data sync' }).click();
    const card = page.getByTestId('backfill-card-rooflink_lineitems');
    await card.waitFor({ timeout: 10_000 });

    // Mock lineitems run has 40 records — finishes in a few seconds.
    await card.getByRole('button', { name: /^Run (now|sync)$/ }).click();

    // Wait for terminal state. Sonner's data-type changes from 'loading'
    // to 'success' when we replace the toast on completion. Mock lineitems
    // run has 40 records · batch=2 · ~1.1s/tick (chain delay) so total
    // wall time is ~22-25s. Give 45s of headroom.
    const successToast = page
      .locator('[data-sonner-toast][data-type="success"]')
      .filter({ hasText: /Rooflink/i });
    await expect(successToast).toBeVisible({ timeout: 45_000 });

    // The success toast title should NOT mention the snake_case identifier.
    const text = (await successToast.textContent()) ?? '';
    expect(text).not.toMatch(/rooflink_lineitems/);
    expect(text).toMatch(/Rooflink estimate line items|Rooflink line items/i);
  });

  test('Tabs separate Reports from Data sync', async ({ browser }) => {
    const context = await browser.newContext();
    await signInAs(context);
    const page = await context.newPage();

    await page.goto('/dashboard/scheduler');
    // Reports tab is the default — should show brief cards.
    await expect(page.getByText('Daily AR brief', { exact: true })).toBeVisible();
    await expect(page.getByTestId('backfill-card-rooflink_jobs')).toHaveCount(0);

    // Switch tab — brief cards disappear, backfill cards appear.
    await page.getByRole('tab', { name: 'Data sync' }).click();
    await expect(page.getByTestId('backfill-card-rooflink_jobs')).toBeVisible();
    await expect(page.getByText('Daily AR brief', { exact: true })).toHaveCount(0);
  });
});
