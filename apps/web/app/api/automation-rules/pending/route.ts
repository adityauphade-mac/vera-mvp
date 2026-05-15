import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { withAuth } from '@/lib/auth-helpers';

export const runtime = 'nodejs';

/**
 * GET /api/automation-rules/pending — list pending sends for the tenant.
 *
 * Query params:
 *   status=pending|missing_recipient|approved|rejected|sent|expired|pending_send_failed
 *     Optional. Defaults to open rows (pending + missing_recipient).
 *   limit  — default 100, max 500.
 */

const OPEN_STATUSES = ['pending', 'missing_recipient'] as const;

export async function GET(req: Request) {
  return withAuth(async (audit) => {
    const url = new URL(req.url);
    const statusParam = url.searchParams.get('status');
    const limitParam = url.searchParams.get('limit');
    const limit = Math.max(
      1,
      Math.min(500, limitParam ? Number(limitParam) || 100 : 100),
    );

    const where = {
      tenantId: audit.tenantId,
      ...(statusParam
        ? { status: statusParam }
        : { status: { in: [...OPEN_STATUSES] } }),
    };

    const rows = await db.pendingRuleSend.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: limit,
      include: {
        rule: {
          select: { id: true, name: true, metric: true, operator: true, threshold: true },
        },
      },
    });

    return NextResponse.json({
      pending: rows,
      counts: await groupCounts(audit.tenantId),
    });
  });
}

async function groupCounts(tenantId: number) {
  const rows = await db.pendingRuleSend.groupBy({
    by: ['status'],
    where: { tenantId },
    _count: { _all: true },
  });
  const out: Record<string, number> = {};
  for (const r of rows) out[r.status] = r._count._all;
  return out;
}
