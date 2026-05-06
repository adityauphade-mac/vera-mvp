import { expect, test } from '@playwright/test';

// Drives the three Send now buttons (Daily / Weekly / Monthly) and reports
// the API responses. Uses the real Resend integration — recipient must be
// the Resend account holder until a domain is verified.

const RECIPIENT = 'adityauphade@makanalytics.org';

test('send all three briefs', async ({ page }) => {
  test.setTimeout(60_000);
  await page.setViewportSize({ width: 1440, height: 1300 });

  const responses: Array<{
    cadence: string;
    status: number;
    subject?: string;
    id?: string;
    pdfBytes?: number;
    error?: string;
  }> = [];
  page.on('response', async (res) => {
    if (!res.url().includes('/api/brief/send')) return;
    try {
      const body = await res.json();
      const reqBody = res.request().postData();
      const cadence = reqBody ? JSON.parse(reqBody).cadence ?? 'daily' : '?';
      responses.push({
        cadence,
        status: res.status(),
        subject: body.subject,
        id: body.id,
        pdfBytes: body.pdfBytes,
        error: body?.error?.message,
      });
    } catch {
      // ignore
    }
  });

  await page.goto('/dashboard/scheduler');
  await page.waitForLoadState('networkidle');

  // Fill all three recipient inputs
  const recipientInputs = page.locator('input[type="email"]');
  await expect(recipientInputs).toHaveCount(3);
  for (let i = 0; i < 3; i++) {
    await recipientInputs.nth(i).fill(RECIPIENT);
  }

  // Click each Send now button in order: Daily, Weekly, Monthly
  const sendButtons = page.getByRole('button', { name: /^Send now$/i });
  await expect(sendButtons).toHaveCount(3);
  for (let i = 0; i < 3; i++) {
    await sendButtons.nth(i).click();
    // Wait for the success badge or error to appear before triggering the next
    const card = page.locator('[role="article"], section, div').nth(i);
    await page.waitForTimeout(2000); // give Resend time to respond
  }

  // Wait a bit for all responses to land
  await page.waitForTimeout(1500);

  console.log('=== /api/brief/send responses ===');
  for (const r of responses) {
    console.log(JSON.stringify(r, null, 2));
  }
});
