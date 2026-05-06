import { expect, test } from '@playwright/test';

test.describe('Docs (/docs) — handbook', () => {
  test('renders all six sections and the back link', async ({ page }) => {
    await page.goto('/docs');

    await expect(
      page.getByRole('heading', { name: /How I think, in detail/i }),
    ).toBeVisible();

    // Section headers — all six.
    await expect(page.getByText(/A read-only AR specialist/i)).toBeVisible();
    await expect(page.getByText(/'in AR' actually means/i)).toBeVisible();
    await expect(page.getByText(/A 0–100 score on every AR job/i)).toBeVisible();
    await expect(page.getByText(/Five reports, two cadences/i)).toBeVisible();
    await expect(page.getByText(/Default carefully\. Show your work/i)).toBeVisible();
    await expect(page.getByText(/What this MVP doesn.t do/i)).toBeVisible();

    // Back-to-landing link in the top bar.
    await expect(
      page.getByRole('link', { name: /Back to landing page/i }).first(),
    ).toBeVisible();
  });

  test('Net 30 / Net 60 table renders', async ({ page }) => {
    await page.goto('/docs');
    await expect(page.getByText('Within terms', { exact: true }).first()).toBeVisible();
    await expect(page.getByText('1–30 past', { exact: true }).first()).toBeVisible();
    await expect(page.getByText('60+ past', { exact: true }).first()).toBeVisible();
  });

  test('Open the dashboard CTA at the bottom navigates to /dashboard', async ({ page }) => {
    await page.goto('/docs');
    await page
      .getByRole('link', { name: /Open the dashboard/i })
      .first()
      .click();
    await expect(page).toHaveURL(/\/dashboard$/);
  });

  test('TOC scrollspy highlights the section in view', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/docs');

    // Scroll to the Heat section (its anchor is #heat).
    await page.evaluate(() => {
      const el = document.getElementById('heat');
      el?.scrollIntoView({ block: 'start' });
    });
    // Allow the IntersectionObserver to fire.
    await page.waitForTimeout(400);

    const heatLink = page.getByRole('link', { name: 'How Heat works' });
    await expect(heatLink).toHaveAttribute('aria-current', 'true');

    // Scroll to Reports.
    await page.evaluate(() => {
      const el = document.getElementById('reports');
      el?.scrollIntoView({ block: 'start' });
    });
    await page.waitForTimeout(400);

    const reportsLink = page.getByRole('link', { name: 'How each report works' });
    await expect(reportsLink).toHaveAttribute('aria-current', 'true');
    await expect(heatLink).not.toHaveAttribute('aria-current', 'true');
  });
});
