import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { withAuth } from '@/lib/auth-helpers';

export const runtime = 'nodejs';

/**
 * GET /api/schedules — list this tenant's schedules.
 *
 * Writes go through PUT/DELETE on /api/schedules/[cadence]. There is no
 * POST here on purpose: the natural key is (tenantId, cadence), so a
 * verb that distinguishes "first create" from "subsequent edit" would be
 * lying. PUT-as-upsert keeps the API and the UI honest.
 */

export async function GET() {
  return withAuth(async ({ tenantId }) => {
    const schedules = await db.schedule.findMany({
      where: { tenantId },
      orderBy: { cadence: 'asc' },
    });
    return NextResponse.json({ schedules });
  });
}
