import { expect, test, type APIResponse } from '@playwright/test';
import { signInAs } from './_helpers/auth';

/**
 * Contract coverage for /api/audit-logs.
 *
 * Each schedule/brief mutation should produce an `AuditLog` row that
 * shows up in the GET response. The global setup wipes AuditLog, so
 * each test starts from zero and the assertions are deterministic.
 */
test.describe('/api/audit-logs', () => {
  test('rejects unauthenticated GET with 401', async ({ request }) => {
    const res = await request.get('/api/audit-logs');
    expect(res.status()).toBe(401);
  });

  test('signed-in: schedule PUT/DELETE round-trips into audit log', async ({
    browser,
  }) => {
    const context = await browser.newContext();
    await signInAs(context);

    // Clean slate.
    await context.request.delete('/api/schedules/daily');

    // PUT daily → expect `schedule.created` audit row.
    const put = await context.request.put('/api/schedules/daily', {
      data: {
        timeLocal: '08:00',
        timezone: 'America/Chicago',
        recipient: 'audit-test@example.com',
        enabled: true,
      },
    });
    expect(put.status()).toBe(201);

    // PATCH-style PUT with new recipient → expect `schedule.updated`.
    await context.request.put('/api/schedules/daily', {
      data: {
        timeLocal: '08:00',
        timezone: 'America/Chicago',
        recipient: 'audit-test-2@example.com',
        enabled: true,
      },
    });

    // Pause via enabled=false → expect `schedule.paused`.
    await context.request.put('/api/schedules/daily', {
      data: {
        timeLocal: '08:00',
        timezone: 'America/Chicago',
        recipient: 'audit-test-2@example.com',
        enabled: false,
      },
    });

    // Resume → expect `schedule.resumed`.
    await context.request.put('/api/schedules/daily', {
      data: {
        timeLocal: '08:00',
        timezone: 'America/Chicago',
        recipient: 'audit-test-2@example.com',
        enabled: true,
      },
    });

    // Delete → expect `schedule.deleted`.
    await context.request.delete('/api/schedules/daily');

    const list = await readJson(
      await context.request.get('/api/audit-logs?category=schedule&limit=50'),
    );
    const actions = list.entries.map((e: { action: string }) => e.action);

    // Newest-first ordering means deleted comes first.
    expect(actions).toEqual(
      expect.arrayContaining([
        'created',
        'updated',
        'paused',
        'resumed',
        'deleted',
      ]),
    );
    // The created row should reference the schedule entityId.
    const created = list.entries.find(
      (e: { action: string }) => e.action === 'created',
    );
    expect(created.entityType).toBe('Schedule');
    expect(created.entityId).toMatch(/^\d+$/);
    expect(created.userEmail).toBe('developer@levich.co');

    await context.close();
  });

  test('signed-in: filters and pagination work', async ({ browser }) => {
    const context = await browser.newContext();
    await signInAs(context);

    await context.request.delete('/api/schedules/daily');
    // One PUT to seed at least one schedule row.
    await context.request.put('/api/schedules/daily', {
      data: {
        timeLocal: '09:00',
        timezone: 'America/Chicago',
        recipient: 'filter-test@example.com',
        enabled: true,
      },
    });

    // Filter by category=schedule → entries are all schedule.
    const filtered = await readJson(
      await context.request.get('/api/audit-logs?category=schedule&limit=10'),
    );
    expect(filtered.entries.length).toBeGreaterThan(0);
    for (const e of filtered.entries) expect(e.category).toBe('schedule');

    // Filter by an action that doesn't exist → zero rows.
    const empty = await readJson(
      await context.request.get('/api/audit-logs?category=schedule&action=zzz_does_not_exist'),
    );
    expect(empty.entries).toHaveLength(0);
    expect(empty.total).toBe(0);

    // Free-text q on the recipient lands the right row.
    const q = await readJson(
      await context.request.get('/api/audit-logs?q=filter-test'),
    );
    expect(q.entries.length).toBeGreaterThan(0);
    expect(q.entries[0].summary).toMatch(/filter-test/i);

    await context.request.delete('/api/schedules/daily');
    await context.close();
  });

  test('signed-in: rejects bad query params with 400', async ({ browser }) => {
    const context = await browser.newContext();
    await signInAs(context);

    // Limit too large → 400.
    const tooMany = await context.request.get('/api/audit-logs?limit=99999');
    expect(tooMany.status()).toBe(400);

    // Invalid since timestamp → 400.
    const badSince = await context.request.get(
      '/api/audit-logs?since=not-a-date',
    );
    expect(badSince.status()).toBe(400);

    await context.close();
  });
});

async function readJson(res: APIResponse) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (await res.json()) as any;
}
