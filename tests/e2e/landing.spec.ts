import { expect, test } from '@playwright/test';

test.describe('Landing page', () => {
  test('renders hero, feature cards, and CTAs', async ({ page }) => {
    await page.goto('/');

    await expect(page).toHaveTitle(/Vera/);
    await expect(
      page.getByRole('heading', { name: /money that hasn.t come home yet/i }),
    ).toBeVisible();
    await expect(page.getByText('What I do, every morning')).toBeVisible();
    await expect(
      page.getByRole('link', { name: /Open the dashboard/i }).first(),
    ).toBeVisible();
    await expect(
      page.getByRole('link', { name: /Read how I work/i }),
    ).toBeVisible();
  });

  test('CTA navigates to the dashboard', async ({ page }) => {
    await page.goto('/');
    await page
      .getByRole('link', { name: /Open the dashboard/i })
      .first()
      .click();
    await expect(page).toHaveURL(/\/dashboard$/);
    await expect(page.getByRole('heading', { name: /Today.s briefing/i })).toBeVisible();
  });

  test('Read how I work link navigates to /docs', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('link', { name: /Read how I work/i }).click();
    await expect(page).toHaveURL(/\/docs$/);
    await expect(
      page.getByRole('heading', { name: /How I think, in detail/i }),
    ).toBeVisible();
  });
});
