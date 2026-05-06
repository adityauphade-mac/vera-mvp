import { expect, test } from '@playwright/test';

test.describe('Chat panel', () => {
  test('opens and shows suggestions', async ({ page }) => {
    await page.goto('/dashboard');

    const trigger = page.getByRole('button', { name: /Ask Me/i });
    await expect(trigger).toBeVisible();
    await trigger.click();

    await expect(page.getByRole('dialog', { name: /Chat with Vera/i })).toBeVisible();
    await expect(page.getByText(/Try asking/i)).toBeVisible();
    await expect(page.getByRole('button', { name: /Who.s worst this week/i })).toBeVisible();
  });

  test('input is focusable and send button starts disabled', async ({ page }) => {
    await page.goto('/dashboard');
    await page.getByRole('button', { name: /Ask Me/i }).click();

    const input = page.getByRole('textbox', { name: 'Message' });
    await expect(input).toBeVisible();
    const send = page.getByRole('button', { name: 'Send message' });
    await expect(send).toBeDisabled();

    await input.fill('Hello');
    await expect(send).toBeEnabled();
  });

  test('closes when X is clicked', async ({ page }) => {
    await page.goto('/dashboard');
    await page.getByRole('button', { name: /Ask Me/i }).click();
    await page.getByRole('button', { name: /Close chat/i }).click();
    await expect(page.getByRole('dialog', { name: /Chat with Vera/i })).toHaveCount(0);
  });
});
