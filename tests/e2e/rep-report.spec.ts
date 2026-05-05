import { expect, test } from '@playwright/test';

test.describe('Rep outstanding report', () => {
  test('renders leaderboard and metric tiles', async ({ page }) => {
    await page.goto('/dashboard/rep-report');
    await expect(
      page.getByRole('heading', { name: /Where the money is by rep/i }),
    ).toBeVisible();
    await expect(page.getByText('Reps with AR')).toBeVisible();
    await expect(page.getByText('Worst single rep')).toBeVisible();
    await expect(page.getByText(/Leaderboard/i).first()).toBeVisible();
  });

  test('sort filter changes URL', async ({ page }) => {
    await page.goto('/dashboard/rep-report');
    await page.getByRole('link', { name: 'Stuck job count' }).click();
    await expect(page).toHaveURL(/sort=count/);
  });
});
