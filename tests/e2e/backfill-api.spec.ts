import { expect, test } from '@playwright/test';
import { signInAs } from './_helpers/auth';

/**
 * API-level tests for the backfill endpoints. Covers the contract — body
 * shapes, status codes, idempotency — without going through the UI.
 *
 * Auth pattern: signInAs() sets cookies on a BrowserContext, then we issue
 * requests via `context.request` so the cookies travel with each call.
 */

test.describe('Backfill API', () => {
  test('GET /api/backfills returns schedules + runs shape', async ({
    browser,
  }) => {
    const context = await browser.newContext();
    await signInAs(context);
    const res = await context.request.get('/api/backfills');
    expect(res.ok()).toBeTruthy();
    const json = await res.json();
    expect(Array.isArray(json.schedules)).toBe(true);
    expect(Array.isArray(json.runs)).toBe(true);
  });

  test('PUT /api/backfills/[source]/schedule upserts', async ({ browser }) => {
    const context = await browser.newContext();
    await signInAs(context);
    const put = await context.request.put(
      '/api/backfills/rooflink_jobs/schedule',
      {
        data: {
          cadence: 'weekly',
          dayOfWeek: 1,
          timeLocal: '03:00',
          timezone: 'America/Chicago',
          enabled: true,
        },
      },
    );
    expect([200, 201]).toContain(put.status());
    const json = await put.json();
    expect(json.schedule.source).toBe('rooflink_jobs');
    expect(json.schedule.cadence).toBe('weekly');
  });

  test('DELETE /api/backfills/[source]/schedule removes', async ({
    browser,
  }) => {
    const context = await browser.newContext();
    await signInAs(context);
    await context.request.put('/api/backfills/rooflink_jobs/schedule', {
      data: {
        cadence: 'daily',
        timeLocal: '04:00',
        timezone: 'America/Chicago',
        enabled: true,
      },
    });
    const del = await context.request.delete(
      '/api/backfills/rooflink_jobs/schedule',
    );
    expect(del.ok()).toBeTruthy();
  });

  test('POST /runs starts a run and 409s on a second concurrent attempt', async ({
    browser,
  }) => {
    const context = await browser.newContext();
    await signInAs(context);
    const first = await context.request.post(
      '/api/backfills/rooflink_lineitems/runs',
    );
    if (first.status() === 201) {
      const second = await context.request.post(
        '/api/backfills/rooflink_lineitems/runs',
      );
      expect(second.status()).toBe(409);
      const json = await second.json();
      expect(json.error).toBe('already_running');
    } else {
      // A prior test left one in flight — accept that as the constraint.
      expect(first.status()).toBe(409);
    }
  });

  test('GET /api/backfills/active returns the active/recent shape', async ({
    browser,
  }) => {
    const context = await browser.newContext();
    await signInAs(context);
    const res = await context.request.get('/api/backfills/active');
    expect(res.ok()).toBeTruthy();
    const json = await res.json();
    expect(Array.isArray(json.active)).toBe(true);
    expect(Array.isArray(json.recent)).toBe(true);
  });

  test('PUT /api/notifications upserts ops email', async ({ browser }) => {
    const context = await browser.newContext();
    await signInAs(context);
    const put = await context.request.put('/api/notifications', {
      data: { opsEmail: 'ops@example.com' },
    });
    expect(put.ok()).toBeTruthy();
    const json = await put.json();
    expect(json.setting.opsEmail).toBe('ops@example.com');

    const clear = await context.request.put('/api/notifications', {
      data: { opsEmail: null },
    });
    expect(clear.ok()).toBeTruthy();
    const cleared = await clear.json();
    expect(cleared.setting.opsEmail).toBeNull();
  });

  test('unauthenticated requests are 401', async ({ request }) => {
    const r1 = await request.get('/api/backfills');
    expect(r1.status()).toBe(401);
    const r2 = await request.put('/api/notifications', {
      data: { opsEmail: null },
    });
    expect(r2.status()).toBe(401);
  });
});
