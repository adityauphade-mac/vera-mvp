import { expect, test } from '@playwright/test';

const ENDPOINTS = [
  '/api/jobs/aging',
  '/api/jobs/milestones',
  '/api/jobs/follow-ups',
  '/api/jobs/reconciliation',
  '/api/reps/outstanding',
];

test.describe('API endpoints', () => {
  for (const path of ENDPOINTS) {
    test(`${path} returns valid AR data`, async ({ request }) => {
      const res = await request.get(path);
      expect(res.ok()).toBeTruthy();
      const body = await res.json();
      expect(body).toBeTruthy();
      expect(body.asOf).toBeTruthy();
    });
  }

  test('/api/jobs/aging exposes bucket summary', async ({ request }) => {
    const res = await request.get('/api/jobs/aging');
    const body = await res.json();
    expect(body.bucketSummary).toHaveProperty('within-terms');
    expect(body.bucketSummary).toHaveProperty('60-plus-past');
    expect(typeof body.totalCount).toBe('number');
    expect(body.totalCount).toBeGreaterThan(0);
  });

  test('/api/reps/outstanding sorts by dollars by default', async ({ request }) => {
    const res = await request.get('/api/reps/outstanding');
    const body = await res.json();
    expect(Array.isArray(body.reps)).toBeTruthy();
    if (body.reps.length >= 2) {
      expect(body.reps[0].totalOutstanding).toBeGreaterThanOrEqual(body.reps[1].totalOutstanding);
    }
  });

  test('/api/jobs/follow-ups separates queue from follow-ups', async ({ request }) => {
    const res = await request.get('/api/jobs/follow-ups');
    const body = await res.json();
    expect(Array.isArray(body.followUps)).toBeTruthy();
    expect(Array.isArray(body.executiveQueue)).toBeTruthy();
    for (const j of body.executiveQueue) expect(j.heatBand).toBe('critical');
    for (const j of body.followUps) expect(j.heatBand).toBe('hot');
  });
});
