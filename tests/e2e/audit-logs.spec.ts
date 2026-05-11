import { expect, test } from '@playwright/test';
import { signInAs } from './_helpers/auth';

test.describe('Audit log page', () => {
  test.beforeEach(async ({ context }) => {
    await signInAs(context);
  });

  test('renders header + filter bar + empty state when there are no entries', async ({
    page,
    context,
  }) => {
    // Seed nothing on the API side — let the page render its empty state.
    await context.request.delete('/api/schedules/daily');

    await page.goto('/dashboard/audit-logs');
    await expect(
      page.getByRole('heading', { name: /Every action, recorded/i }),
    ).toBeVisible();
    // Filter labels.
    for (const label of ['Category', 'Action', 'Who', 'Search summary']) {
      await expect(page.getByText(label, { exact: true })).toBeVisible();
    }
  });

  test('sidebar contains the Audit log link', async ({ page }) => {
    await page.goto('/dashboard');
    await expect(page.getByRole('link', { name: /Audit log/i })).toBeVisible();
  });

  test('a fresh schedule PUT shows up as a table row + detail sheet opens on click', async ({
    page,
    context,
  }) => {
    // Make sure there's at least one entry.
    await context.request.delete('/api/schedules/daily');
    await context.request.put('/api/schedules/daily', {
      data: {
        timeLocal: '08:00',
        timezone: 'America/Chicago',
        recipient: 'ui-test@example.com',
        enabled: true,
      },
    });

    await page.goto('/dashboard/audit-logs');

    // The schedule.created row should appear on screen with our recipient.
    await expect(page.getByText(/ui-test@example\.com/).first()).toBeVisible();

    // Click the first non-header row.
    await page.getByText(/ui-test@example\.com/).first().click();

    // Sheet opens — title is the summary string.
    await expect(page.getByText('Details', { exact: true })).toBeVisible();

    await context.request.delete('/api/schedules/daily');
  });

  test('category filter narrows the table', async ({ page, context }) => {
    await context.request.delete('/api/schedules/daily');
    await context.request.put('/api/schedules/daily', {
      data: {
        timeLocal: '08:00',
        timezone: 'America/Chicago',
        recipient: 'cat-filter@example.com',
        enabled: true,
      },
    });

    await page.goto('/dashboard/audit-logs?category=auth');

    // With category=auth and no auth events in a fresh test, the schedule
    // row should NOT appear.
    await expect(page.getByText(/cat-filter@example\.com/)).toHaveCount(0);

    await context.request.delete('/api/schedules/daily');
  });
});
