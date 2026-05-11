import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { generateBriefingForTenant } from '@/lib/briefing-generator';
import { verifyCronAuth } from '@/lib/cron-auth';
import { withSystemAuditContext } from '@/lib/audit-context';
import { recordAudit } from '@/lib/audit';

export const runtime = 'nodejs';
export const maxDuration = 120;

/**
 * Cron endpoint, triggered daily at 7am Central by Upstash QStash.
 *
 * For each tenant, generates a fresh AI briefing and writes it to the
 * `Briefing` table. Errors per-tenant are caught so one failure doesn't
 * starve the others.
 *
 * Audit: each successful generation records `briefing.generated_daily`
 * with userId=null (system action). The Briefing row insert is also
 * auto-audited as a generic `briefing.created`; both rows are
 * intentional — operators looking at the audit log get the pretty
 * "generated daily" entry as the headline, with the auto row as
 * supporting detail.
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
    // Each tenant gets its own audit context so auto-audited Briefing
    // writes inside generateBriefingForTenant attribute to the right
    // tenant with userId=null (system).
    await withSystemAuditContext({ tenantId: t.id }, async () => {
      try {
        const r = await generateBriefingForTenant(t.id);
        await recordAudit(db, {
          tenantId: t.id,
          userId: null,
          userEmail: null,
          category: 'briefing',
          action: 'generated_daily',
          entityType: 'Briefing',
          entityId: r.briefingId ? String(r.briefingId) : null,
          summary: `Daily briefing generated: ${r.headline}`,
          details: { headline: r.headline, model: 'gpt-4o' },
        });
        results.push({
          tenantId: t.id,
          status: 'ok',
          briefingId: r.briefingId,
        });
      } catch (e) {
        await recordAudit(db, {
          tenantId: t.id,
          userId: null,
          userEmail: null,
          category: 'briefing',
          action: 'generation_failed',
          summary: 'Daily briefing generation failed',
          details: { error: e instanceof Error ? e.message : String(e) },
        });
        results.push({
          tenantId: t.id,
          status: 'failed',
          error: e instanceof Error ? e.message : String(e),
        });
      }
    });
  }

  return NextResponse.json({
    generated: results.filter((r) => r.status === 'ok').length,
    failed: results.filter((r) => r.status === 'failed').length,
    results,
    at: new Date().toISOString(),
  });
}
