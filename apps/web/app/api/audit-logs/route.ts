import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { withAuth } from '@/lib/auth-helpers';
import { AuditLogQuerySchema, type AuditCategory } from '@vera/types';

export const runtime = 'nodejs';

/**
 * GET /api/audit-logs
 *
 * Returns the audit-log entries for the signed-in user's tenant, sorted
 * newest first. All filter params are optional; the canonical catalog
 * lives in `shared/types/audit.ts`.
 *
 *   ?category=schedule         only schedule events
 *   ?action=updated            specific action
 *   ?userId=12                 specific user; pass userId= (empty) for system
 *   ?entityType=Schedule       narrow to one entity type
 *   ?entityId=23               combine with entityType for "history of this row"
 *   ?since=2026-05-01T00:00Z   inclusive lower bound on createdAt
 *   ?until=2026-05-12T00:00Z   exclusive upper bound
 *   ?q=nanda                   ILIKE substring search over summary
 *   ?limit=50&offset=0         pagination
 */
export async function GET(req: Request) {
  return withAuth(async ({ tenantId }) => {
    const url = new URL(req.url);
    const params = Object.fromEntries(url.searchParams);

    const parsed = AuditLogQuerySchema.safeParse(params);
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'validation_error', issues: parsed.error.issues },
        { status: 400 },
      );
    }
    const q = parsed.data;

    // Build the Prisma where clause from the filter params. The tenantId
    // is always enforced — never trust the client to scope itself.
    const where: {
      tenantId: number;
      category?: AuditCategory;
      action?: string;
      userId?: number | null;
      entityType?: string;
      entityId?: string;
      createdAt?: { gte?: Date; lt?: Date };
      summary?: { contains: string; mode: 'insensitive' };
    } = { tenantId };

    if (q.category) where.category = q.category;
    if (q.action) where.action = q.action;
    // userId = null is meaningful (system actions); we accept it explicitly.
    if (q.userId !== undefined) where.userId = q.userId;
    if (q.entityType) where.entityType = q.entityType;
    if (q.entityId) where.entityId = q.entityId;
    if (q.since || q.until) {
      where.createdAt = {};
      if (q.since) where.createdAt.gte = new Date(q.since);
      if (q.until) where.createdAt.lt = new Date(q.until);
    }
    if (q.q) {
      where.summary = { contains: q.q, mode: 'insensitive' };
    }

    const [entries, total] = await Promise.all([
      db.auditLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: q.limit,
        skip: q.offset,
      }),
      db.auditLog.count({ where }),
    ]);

    return NextResponse.json({
      entries,
      total,
      limit: q.limit,
      offset: q.offset,
    });
  });
}
