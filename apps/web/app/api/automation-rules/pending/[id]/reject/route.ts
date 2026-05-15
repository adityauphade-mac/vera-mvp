import { NextResponse } from 'next/server';
import { rejectPendingSendSchema } from '@vera/types';
import { db } from '@/lib/db';
import { withAuth } from '@/lib/auth-helpers';
import { recordAudit } from '@/lib/audit';

export const runtime = 'nodejs';

type RouteContext = { params: Promise<{ id: string }> };

/**
 * POST /api/automation-rules/pending/[id]/reject
 *
 * Body: { reason?: string } — optional rejection reason captured in the
 * audit row + the pending row so the reviewer can leave a note.
 *
 * Marks the row status='rejected'. Rejected rows DO NOT count against the
 * rule's daily cap (the evaluator counts pending+sent only).
 */
export async function POST(req: Request, ctx: RouteContext) {
  return withAuth(async (audit) => {
    const { id: idRaw } = await ctx.params;
    const id = Number(idRaw);
    if (!Number.isInteger(id) || id <= 0) {
      return NextResponse.json({ error: 'invalid_id' }, { status: 400 });
    }

    let bodyRaw: unknown = {};
    try {
      bodyRaw = await req.json();
    } catch {
      // optional body — empty is fine
    }
    const parsed = rejectPendingSendSchema.safeParse(bodyRaw);
    if (!parsed.success) {
      return NextResponse.json(
        {
          error: {
            code: 'validation_error',
            message: parsed.error.issues.map((i) => i.message).join('; '),
          },
        },
        { status: 400 },
      );
    }

    const row = await db.pendingRuleSend.findFirst({
      where: { id, tenantId: audit.tenantId },
      include: { rule: { select: { name: true } } },
    });
    if (!row) {
      return NextResponse.json({ error: 'not_found' }, { status: 404 });
    }
    if (row.status !== 'pending' && row.status !== 'missing_recipient') {
      return NextResponse.json(
        {
          error: {
            code: 'wrong_status',
            message: `Pending send is in status "${row.status}" — only "pending" or "missing_recipient" can be rejected.`,
          },
        },
        { status: 400 },
      );
    }

    const reason = parsed.data.reason?.trim() || null;
    const updated = await db.pendingRuleSend.update({
      where: { id },
      data: {
        status: 'rejected',
        rejectionReason: reason,
        reviewedById: audit.userId ?? null,
        reviewedAt: new Date(),
      },
    });

    await recordAudit(db, {
      tenantId: audit.tenantId,
      userId: audit.userId,
      userEmail: audit.userEmail,
      category: 'automation_rules',
      action: 'pending_rejected',
      entityType: 'PendingRuleSend',
      entityId: String(id),
      summary: reason
        ? `Rejected rule "${row.rule.name}" send: ${reason}`
        : `Rejected rule "${row.rule.name}" send`,
      details: {
        ruleId: updated.ruleId,
        pendingId: updated.id,
        reason,
        proposedRecipient: row.proposedRecipient,
        proposedSubject: row.proposedSubject,
      },
    });

    return NextResponse.json({ ok: true });
  });
}
