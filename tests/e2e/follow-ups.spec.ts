import { expect, test } from '@playwright/test';
import { signInAs } from './_helpers/auth';

test.describe('Follow-ups & executive review', () => {
  test.beforeEach(async ({ context }) => {
    await signInAs(context);
  });

  test('renders both tabs and metric tiles', async ({ page }) => {
    await page.goto('/dashboard/follow-ups');
    await expect(
      page.getByRole('heading', { name: /Who I.d nudge today/i }),
    ).toBeVisible();
    await expect(page.getByText(/Hot — for reps/)).toBeVisible();
    await expect(page.getByText(/Critical — exec review/)).toBeVisible();
    await expect(page.getByRole('tab', { name: /Rep follow-ups/ })).toBeVisible();
    await expect(page.getByRole('tab', { name: /Executive review queue/ })).toBeVisible();
  });

  test('switches to the executive queue tab', async ({ page }) => {
    await page.goto('/dashboard/follow-ups');
    await page.getByRole('tab', { name: /Executive review queue/ }).click();
    await expect(page).toHaveURL(/tab=queue/);
  });

  test('opens a draft email modal in preview mode', async ({ page }) => {
    await page.goto('/dashboard/follow-ups');
    const draftButton = page.getByRole('button', { name: 'Draft email' }).first();
    await expect(draftButton).toBeVisible();
    await draftButton.click();

    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText(/^Subject$/)).toBeVisible();
    await expect(
      dialog.getByRole('button', { name: /Copy to clipboard/i }),
    ).toBeVisible();
    await expect(dialog.getByRole('button', { name: /Send via Vera/i })).toBeVisible();

    await page.getByRole('button', { name: /Close/i }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
  });

  test('blocks send and surfaces inline error when subject is empty', async ({
    page,
  }) => {
    // Track API hits — the validation guard must short-circuit before any
    // network round-trip.
    let apiCalls = 0;
    await page.route('**/api/follow-ups/send', async (route) => {
      apiCalls += 1;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ id: 'should_not_be_called' }),
      });
    });

    await page.goto('/dashboard/follow-ups');
    await page.getByRole('button', { name: 'Draft email' }).first().click();
    const dialog = page.getByRole('dialog');
    await dialog.getByRole('button', { name: /Send via Vera/i }).click();

    // Clear the subject — RHF's onChange resolver fires immediately, so the
    // inline FormMessage error must appear without a submit attempt.
    const subject = dialog.locator('#follow-up-subject');
    await subject.fill('');

    await expect(dialog.getByText(/Subject required/i)).toBeVisible();

    // The Send button must be disabled while the form is invalid.
    const sendBtn = dialog.getByRole('button', { name: /^Send$/ });
    await expect(sendBtn).toBeDisabled();

    // Attempt the click anyway — disabled buttons should not fire submit, and
    // even if they did the resolver should short-circuit before fetch.
    await sendBtn.click({ force: true }).catch(() => {
      /* expected: disabled */
    });

    // Confirm dialog must never appear, because send never started.
    await expect(
      page.getByRole('dialog').filter({ hasText: /Send follow-up to/ }),
    ).toHaveCount(0);

    expect(apiCalls).toBe(0);
  });

  test('blocks send and surfaces inline error when cc contains invalid email', async ({
    page,
  }) => {
    let apiCalls = 0;
    await page.route('**/api/follow-ups/send', async (route) => {
      apiCalls += 1;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ id: 'should_not_be_called' }),
      });
    });

    await page.goto('/dashboard/follow-ups');
    await page.getByRole('button', { name: 'Draft email' }).first().click();
    const dialog = page.getByRole('dialog');
    await dialog.getByRole('button', { name: /Send via Vera/i }).click();

    // EmailChipInput rejects invalid input at the chip level (so it never
    // becomes a chip), surfacing a draft-level "not a valid email" hint. The
    // Send button stays enabled because no invalid value is committed to the
    // form, which is the desired behavior — invalid email never reaches the
    // API.
    const ccInput = dialog.getByRole('group', { name: 'Cc' }).getByRole('textbox');
    await ccInput.fill('not-an-email');
    await ccInput.press('Enter');

    // No chip was added.
    await expect(dialog.getByText('not-an-email')).toHaveCount(0);

    // Inline validation hint from EmailChipInput.
    await expect(
      dialog.getByText(/not a valid email|invalid email/i).first(),
    ).toBeVisible();

    // No network call occurred.
    expect(apiCalls).toBe(0);
  });

  test('sends a follow-up email through the audited pipeline', async ({ page }) => {
    // Mock the send route — assert payload shape, then return success.
    let receivedPayload: Record<string, unknown> | null = null;
    await page.route('**/api/follow-ups/send', async (route) => {
      const req = route.request();
      try {
        receivedPayload = req.postDataJSON();
      } catch {
        receivedPayload = null;
      }
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          id: 'resend_test_123',
          to: (receivedPayload as { to?: string[] })?.to ?? [],
          cc: (receivedPayload as { cc?: string[] })?.cc ?? [],
          subject: (receivedPayload as { subject?: string })?.subject ?? '',
        }),
      });
    });

    await page.goto('/dashboard/follow-ups');
    await page.getByRole('button', { name: 'Draft email' }).first().click();

    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();

    // Switch from preview → compose.
    await dialog.getByRole('button', { name: /Send via Vera/i }).click();
    await expect(dialog.getByText(/^Compose to /)).toBeVisible();

    // From is locked.
    await expect(dialog.getByText('Locked', { exact: true })).toBeVisible();
    await expect(dialog.getByText(/Vera Calloway/)).toBeVisible();

    // To has at least one chip (the rep) — there's no easy aria target for the
    // chip itself, so we look for the wrapping group's "1 of 6" counter.
    await expect(dialog.getByText(/1 of 6/).first()).toBeVisible();

    // Add a CC.
    const ccInput = dialog
      .getByRole('group', { name: 'Cc' })
      .getByRole('textbox');
    await ccInput.fill('billing@example.com');
    await ccInput.press('Enter');
    await expect(dialog.getByText('billing@example.com')).toBeVisible();

    // Edit subject.
    const subject = dialog.locator('#follow-up-subject');
    await subject.fill('Edited subject for QA');

    // Click Send → confirm dialog appears.
    await dialog.getByRole('button', { name: /^Send$/ }).click();
    const confirm = page.getByRole('dialog').filter({ hasText: /Send follow-up to/ });
    await expect(confirm).toBeVisible();
    await confirm.getByRole('button', { name: /Send now/ }).click();

    // Toast confirms success and modal closes.
    await expect(page.getByText(/Sent to /).first()).toBeVisible();
    await expect(page.getByRole('dialog')).toHaveCount(0);

    // Verify the payload reached the route in the expected shape.
    expect(receivedPayload).not.toBeNull();
    const payload = receivedPayload as {
      jobId?: number;
      to?: string[];
      cc?: string[];
      subject?: string;
      body?: string;
    };
    expect(payload.to?.length ?? 0).toBeGreaterThanOrEqual(1);
    expect(payload.cc).toContain('billing@example.com');
    expect(payload.subject).toBe('Edited subject for QA');
    expect(typeof payload.body).toBe('string');
    expect((payload.body ?? '').length).toBeGreaterThan(0);
  });
});
