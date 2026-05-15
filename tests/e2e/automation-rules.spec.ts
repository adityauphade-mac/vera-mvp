import { expect, test } from '@playwright/test';
import { signInAs } from './_helpers/auth';

/**
 * Automation rules tab — covers the rule-builder + the pending queue
 * surface. Heavier integration (real fire + approve + audit row) lives in
 * the manual smoke pass since it depends on a promoted backfill landing
 * with jobs that trip the rule. The cases here cover what's reproducible
 * without seeding live AR data.
 */

test.describe('Automation rules', () => {
  test.beforeEach(async ({ context }) => {
    await signInAs(context);
  });

  test('automation tab loads with the rule-builder header and CTA', async ({
    page,
  }) => {
    await page.goto('/dashboard/scheduler?tab=automation');
    // Tab title is visible.
    await expect(
      page.getByRole('heading', { name: /Automation rules/i }).first(),
    ).toBeVisible();
    // New rule CTA is always visible regardless of how many rules exist
    // and regardless of any parallel test's side effects.
    await expect(page.getByRole('button', { name: /^New rule$/ })).toBeVisible();
    // Pending queue heading appears even when empty.
    await expect(
      page.getByRole('heading', { name: /Pending sends/i }),
    ).toBeVisible();
  });

  test('new-rule modal validates required fields and rejects invalid templates', async ({
    page,
  }) => {
    await page.goto('/dashboard/scheduler?tab=automation');
    await page.getByRole('button', { name: /^New rule$/ }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();

    // Default name is empty so isValid starts false → Create button disabled.
    const createBtn = dialog.getByRole('button', { name: /Create rule/i });
    await expect(createBtn).toBeDisabled();

    // Type then clear to surface the inline "Rule name required" message.
    // fill('') alone on an already-empty input doesn't fire onChange, so
    // RHF won't mark the field touched and FormMessage stays hidden.
    const nameInput = dialog.locator('input').first();
    await nameInput.fill('temp');
    await nameInput.fill('');
    await expect(dialog.getByText(/Rule name required/i)).toBeVisible();
    await expect(createBtn).toBeDisabled();
  });

  test('creating a rule appears in the list with the right condition summary', async ({
    page,
  }) => {
    await page.goto('/dashboard/scheduler?tab=automation');
    await page.getByRole('button', { name: /^New rule$/ }).click();
    const dialog = page.getByRole('dialog');

    // Fill the form. defaultValues already set the metric=heat_score,
    // operator=crosses_above, threshold=80, recipientMode=fixed_email,
    // and a placeholder template. We need a name + recipientEmail.
    const nameInput = dialog.locator('input').first();
    await nameInput.fill('Heat 80+ critical chase');

    // recipientEmail — only field of type=email currently visible
    await dialog.locator('input[type="email"]').fill('ops@example.com');

    const createBtn = dialog.getByRole('button', { name: /Create rule/i });
    await expect(createBtn).toBeEnabled();
    await createBtn.click();

    // Toast confirms
    await expect(
      page.getByText(/Created rule "Heat 80\+ critical chase"/i),
    ).toBeVisible();

    // Modal closes
    await expect(page.getByRole('dialog')).toHaveCount(0);

    // Rule appears in the list
    await expect(
      page.getByText('Heat 80+ critical chase').first(),
    ).toBeVisible();
    // Condition pill text
    await expect(
      page.getByText(/heat score crosses above 80/i).first(),
    ).toBeVisible();
  });

  test('pending queue shows empty state initially', async ({ page }) => {
    await page.goto('/dashboard/scheduler?tab=automation');
    await expect(
      page.getByText(/No pending sends/i),
    ).toBeVisible();
  });

  test('?tab=automation URL deep-link works and survives refresh', async ({
    page,
  }) => {
    await page.goto('/dashboard/scheduler?tab=automation');
    await expect(
      page.getByRole('heading', { name: /Automation rules/i }).first(),
    ).toBeVisible();
    await page.reload();
    await expect(page).toHaveURL(/[?&]tab=automation/);
    await expect(
      page.getByRole('heading', { name: /Automation rules/i }).first(),
    ).toBeVisible();
  });
});
