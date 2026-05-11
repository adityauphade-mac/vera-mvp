import { expect, test, type APIResponse } from '@playwright/test';
import { signInAs } from './_helpers/auth';

/**
 * Contract coverage for /api/schedules and /api/schedules/[cadence].
 *
 * The cron loop itself is tested manually end-to-end. These specs assert:
 *   - Auth gate
 *   - PUT validates input and persists
 *   - GET round-trips the saved row
 *   - PUT is an UPSERT keyed on (tenantId, cadence) — re-PUT replaces,
 *     never duplicates
 *   - DELETE removes the row
 *   - 401 on unauthenticated, 400 on malformed, 404 on delete-when-absent
 */
test.describe('/api/schedules', () => {
  test('rejects unauthenticated requests with 401', async ({ request }) => {
    const put = await request.put('/api/schedules/daily', {
      data: {
        timeLocal: '08:00',
        timezone: 'America/Chicago',
        recipient: 'developer@levich.co',
      },
    });
    expect(put.status()).toBe(401);

    const get = await request.get('/api/schedules');
    expect(get.status()).toBe(401);

    const del = await request.delete('/api/schedules/daily');
    expect(del.status()).toBe(401);
  });

  test('signed-in: PUT creates schedule, GET returns it, nextRunAt is in the future', async ({
    browser,
  }) => {
    const context = await browser.newContext();
    await signInAs(context);

    // Clean slate for this cadence so the test is hermetic.
    await context.request.delete('/api/schedules/daily');

    const put = await context.request.put('/api/schedules/daily', {
      data: {
        timeLocal: '08:00',
        timezone: 'America/Chicago',
        recipient: 'developer@levich.co',
        enabled: true,
      },
    });
    expect(put.status()).toBe(201);
    const created = await readJson(put);

    expect(created.schedule).toMatchObject({
      cadence: 'daily',
      timeLocal: '08:00',
      timezone: 'America/Chicago',
      recipient: 'developer@levich.co',
      enabled: true,
      tenantId: 1,
    });
    const nextRunAt = new Date(created.schedule.nextRunAt);
    expect(nextRunAt.getTime()).toBeGreaterThan(Date.now());

    const get = await context.request.get('/api/schedules');
    expect(get.status()).toBe(200);
    const list = await readJson(get);
    const found = list.schedules.filter((s: { cadence: string }) => s.cadence === 'daily');
    expect(found).toHaveLength(1);
    expect(found[0].id).toBe(created.schedule.id);

    await context.request.delete('/api/schedules/daily');
    await context.close();
  });

  test('signed-in: PUT twice with a different recipient REPLACES (no duplicate)', async ({
    browser,
  }) => {
    const context = await browser.newContext();
    await signInAs(context);

    await context.request.delete('/api/schedules/daily');

    const first = await context.request.put('/api/schedules/daily', {
      data: {
        timeLocal: '08:00',
        timezone: 'America/Chicago',
        recipient: 'aditya@example.com',
        enabled: true,
      },
    });
    expect(first.status()).toBe(201);
    const firstRow = (await readJson(first)).schedule;

    const second = await context.request.put('/api/schedules/daily', {
      data: {
        timeLocal: '08:00',
        timezone: 'America/Chicago',
        recipient: 'nanda@example.com',
        enabled: true,
      },
    });
    expect(second.status()).toBe(200);
    const secondRow = (await readJson(second)).schedule;

    expect(secondRow.id).toBe(firstRow.id);
    expect(secondRow.recipient).toBe('nanda@example.com');

    // Timing fields unchanged → nextRunAt should be preserved.
    expect(secondRow.nextRunAt).toBe(firstRow.nextRunAt);

    const list = await readJson(await context.request.get('/api/schedules'));
    const daily = list.schedules.filter((s: { cadence: string }) => s.cadence === 'daily');
    expect(daily).toHaveLength(1);
    expect(daily[0].recipient).toBe('nanda@example.com');

    await context.request.delete('/api/schedules/daily');
    await context.close();
  });

  test('signed-in: PUT with a different time RECOMPUTES nextRunAt', async ({
    browser,
  }) => {
    const context = await browser.newContext();
    await signInAs(context);

    await context.request.delete('/api/schedules/daily');

    const first = (
      await readJson(
        await context.request.put('/api/schedules/daily', {
          data: {
            timeLocal: '08:00',
            timezone: 'America/Chicago',
            recipient: 'developer@levich.co',
            enabled: true,
          },
        }),
      )
    ).schedule;

    const second = (
      await readJson(
        await context.request.put('/api/schedules/daily', {
          data: {
            timeLocal: '17:00',
            timezone: 'America/Chicago',
            recipient: 'developer@levich.co',
            enabled: true,
          },
        }),
      )
    ).schedule;

    expect(second.id).toBe(first.id);
    expect(second.timeLocal).toBe('17:00');
    expect(second.nextRunAt).not.toBe(first.nextRunAt);

    await context.request.delete('/api/schedules/daily');
    await context.close();
  });

  test('signed-in: DELETE removes the row, idempotent 404 thereafter', async ({
    browser,
  }) => {
    const context = await browser.newContext();
    await signInAs(context);

    await context.request.put('/api/schedules/daily', {
      data: {
        timeLocal: '08:00',
        timezone: 'America/Chicago',
        recipient: 'developer@levich.co',
        enabled: true,
      },
    });

    const del = await context.request.delete('/api/schedules/daily');
    expect(del.status()).toBe(200);

    const list = await readJson(await context.request.get('/api/schedules'));
    expect(
      list.schedules.filter((s: { cadence: string }) => s.cadence === 'daily'),
    ).toHaveLength(0);

    const delAgain = await context.request.delete('/api/schedules/daily');
    expect(delAgain.status()).toBe(404);

    await context.close();
  });

  test('signed-in: rejects unknown cadence with 400', async ({ browser }) => {
    const context = await browser.newContext();
    await signInAs(context);

    const put = await context.request.put('/api/schedules/fortnightly', {
      data: {
        timeLocal: '08:00',
        timezone: 'America/Chicago',
        recipient: 'developer@levich.co',
      },
    });
    expect(put.status()).toBe(400);

    await context.close();
  });

  test('signed-in: rejects malformed body with 400', async ({ browser }) => {
    const context = await browser.newContext();
    await signInAs(context);

    const put = await context.request.put('/api/schedules/daily', {
      data: {
        timeLocal: '25:00', // not a valid time
        timezone: '',
        recipient: 'not-an-email',
      },
    });
    expect(put.status()).toBe(400);

    await context.close();
  });
});

async function readJson(res: APIResponse) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (await res.json()) as any;
}
