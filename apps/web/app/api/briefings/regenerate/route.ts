import { NextResponse } from 'next/server';
import { generateBriefingForTenant } from '@/lib/briefing-generator';
import { withAuth } from '@/lib/auth-helpers';
import { recordAudit } from '@/lib/audit';
import { db } from '@/lib/db';

export const runtime = 'nodejs';
export const maxDuration = 60;

/**
 * Manual regenerate endpoint. Used by the "Regenerate" / "Fetch latest
 * news" button on the dashboard's BriefingCard. Rate-limited at the UI
 * layer (one per hour).
 *
 * The Briefing row write inside generateBriefingForTenant is also
 * auto-audited by the Prisma extension as a generic "Briefing #N
 * created", but we record a prettier `briefing.regenerated` row here
 * so the audit-log table tells the human-readable story.
 */

export async function POST() {
  return withAuth(async (audit) => {
    try {
      const result = await generateBriefingForTenant(audit.tenantId);
      // Flatten sources into the BriefingSource[] shape the client renders.
      const sources: Array<{
        type: 'nws' | 'news';
        label: string;
        detail?: string;
        url?: string;
      }> = [];
      for (const a of result.sources?.nws ?? []) {
        sources.push({
          type: 'nws',
          label: a.event ?? a.headline ?? 'NWS alert',
          detail: a.severity,
          url: a.url,
        });
      }
      for (const h of result.sources?.news ?? []) {
        sources.push({
          type: 'news',
          label: h.title,
          detail: h.source,
          url: h.url,
        });
      }

      await recordAudit(db, {
        tenantId: audit.tenantId,
        userId: audit.userId,
        userEmail: audit.userEmail,
        category: 'briefing',
        action: 'regenerated',
        entityType: 'Briefing',
        entityId: result.briefingId ? String(result.briefingId) : null,
        summary: `Briefing regenerated: ${result.headline}`,
        details: {
          headline: result.headline,
          sources: { count: sources.length },
          model: 'gpt-4o',
        },
      });

      return NextResponse.json({
        ok: true,
        briefing: {
          headline: result.headline,
          bodyMd: result.bodyMd,
          sources,
          generatedAt: new Date().toISOString(),
          model: 'gpt-4o',
        },
      });
    } catch (e) {
      await recordAudit(db, {
        tenantId: audit.tenantId,
        userId: audit.userId,
        userEmail: audit.userEmail,
        category: 'briefing',
        action: 'generation_failed',
        summary: 'Briefing regeneration failed',
        details: { error: e instanceof Error ? e.message : String(e) },
      });
      return NextResponse.json(
        {
          ok: false,
          error: e instanceof Error ? e.message : String(e),
        },
        { status: 500 },
      );
    }
  });
}
