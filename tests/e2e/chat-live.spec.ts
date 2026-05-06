import { expect, test } from '@playwright/test';

// Gated behind RUN_LIVE_AI=1 per CLAUDE.md — exercises the real /api/chat
// endpoint and costs a couple of cents per run. CI mocks /api/chat instead.
test.describe('Vera chat — live response & avatar', () => {
  test.skip(
    !process.env.RUN_LIVE_AI,
    'Set RUN_LIVE_AI=1 to run live-API smoke tests.',
  );

  test('FAB shows avatar, modal header shows avatar, sending a message produces a streamed response with avatar', async ({
    page,
  }) => {
    await page.goto('/dashboard');

    // 1. The "Ask Me" FAB button shows the avatar (aria-label="Vera").
    const fab = page.getByRole('button', { name: /Ask Me/i });
    await expect(fab).toBeVisible();
    const fabAvatar = fab.locator('[aria-label="Vera"]');
    await expect(fabAvatar).toBeVisible();

    // 2. Open the modal — header shows the avatar next to the "Vera" name.
    await fab.click();
    const dialog = page.getByRole('dialog', { name: /Chat with Vera/i });
    await expect(dialog).toBeVisible();
    const header = dialog.locator('header');
    await expect(header.locator('[aria-label="Vera"]')).toBeVisible();
    await expect(header.getByText(/^Vera$/)).toBeVisible();

    // 3. Send a message.
    const input = dialog.getByRole('textbox', { name: 'Message' });
    await input.fill('Say hi in one short sentence.');
    await dialog.getByRole('button', { name: 'Send message' }).click();

    // 4. Wait for streamed assistant response — give it up to 30s.
    const veraReply = dialog
      .locator('div.flex.gap-3', { has: page.locator('[aria-label="Vera"]') })
      .last();
    await expect(veraReply).toBeVisible({ timeout: 30_000 });
    await expect
      .poll(async () => (await veraReply.innerText()).trim().length, {
        timeout: 30_000,
        intervals: [500, 1000, 2000],
      })
      .toBeGreaterThan(5);

    // 5. The response container has both the avatar and the text.
    await expect(veraReply.locator('[aria-label="Vera"]')).toBeVisible();
    await page.screenshot({
      path: 'test-results/vera-chat-response.png',
      fullPage: false,
    });
  });
});
