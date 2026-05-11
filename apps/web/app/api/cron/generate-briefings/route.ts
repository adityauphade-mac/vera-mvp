import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { generateBriefingForTenant } from '@/lib/briefing-generator';
import { verifyCronAuth } from '@/lib/cron-auth';

export const runtime = 'nodejs';
export const maxDuration = 120;

/**
 * Cron endpoint, triggered daily at 7am Central by Upstash QStash.
 *
 * For each tenant, generates a fresh AI briefing and writes it to the
 * `Briefing` table. Errors per-tenant are caught so one failure doesn't
 * starve the others.
 */

export async function POST(req: Request) {
  const auth = await verifyCronAuth(req);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const tenants = await db.tenant.findMany();
  const results: Array<{
    tenantId: number;
    status: 'ok' | 'failed';
    briefingId?: number;
    error?: string;
  }> = [];

  for (const t of tenants) {
    try {
      const r = await generateBriefingForTenant(t.id);
      results.push({
        tenantId: t.id,
        status: 'ok',
        briefingId: r.briefingId,
      });
    } catch (e) {
      results.push({
        tenantId: t.id,
        status: 'failed',
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }

  return NextResponse.json({
    generated: results.filter((r) => r.status === 'ok').length,
    failed: results.filter((r) => r.status === 'failed').length,
    results,
    at: new Date().toISOString(),
  });
}
