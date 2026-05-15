import { NextResponse } from 'next/server';
import { approvePendingSendSchema } from '@vera/types';
import { db } from '@/lib/db';
import { withAuth } from '@/lib/auth-helpers';
import { withSuppressedAutoAudit } from '@/lib/audit-context';
import { recordAudit } from '@/lib/audit';
import { sendEmail, isEmailConfigured } from '@/lib/email';
import {
  renderEmailLayout,
  EMAIL_COLORS,
  escapeEmailHtml,
} from '@/lib/email-layout';

export const runtime = 'nodejs';
export const maxDuration = 30;

type RouteContext = { params: Promise<{ id: string }> };

/**
 * POST /api/automation-rules/pending/[id]/approve
 *
 * Body: { recipientOverride?: string|null }
 *
 * Approves a pending rule send. Behaviour:
 *   - 'pending' status: send to row.proposedRecipient (override forbidden).
 *   - 'missing_recipient' status: requires body.recipientOverride.
 *   - Any other status: 400.
 *
 * On send success: SendLog row written with cadence='automation', pending
 * row marked status='sent' with sendLogId set, audit row category=
 * automation_rules action=pending_approved.
 *
 * On send failure: pending row marked status='pending_send_failed' so the
 * UI can surface the error and let the user retry, audit row category=
 * automation_rules action=pending_send_failed.
 */
export async function POST(req: Request, ctx: RouteContext) {
  return withAuth(async (audit) => {
    const { id: idRaw } = await ctx.params;
    const id = Number(idRaw);
    if (!Number.isInteger(id) || id <= 0) {
      return NextResponse.json({ error: 'invalid_id' }, { status: 400 });
    }

    if (!isEmailConfigured()) {
      return NextResponse.json(
        {
          error: {
            code: 'email_not_configured',
            message: 'Resend is not configured. Set RESEND_API_KEY.',
          },
        },
        { status: 503 },
      );
    }

    let bodyRaw: unknown = {};
    try {
      bodyRaw = await req.json();
    } catch {
      // empty body — that's fine, recipientOverride is optional
    }
    const parsedBody = approvePendingSendSchema.safeParse(bodyRaw);
    if (!parsedBody.success) {
      return NextResponse.json(
        {
          error: {
            code: 'validation_error',
            message: parsedBody.error.issues.map((i) => i.message).join('; '),
          },
        },
        { status: 400 },
      );
    }

    const row = await db.pendingRuleSend.findFirst({
      where: { id, tenantId: audit.tenantId },
      include: { rule: true },
    });
    if (!row) {
      return NextResponse.json({ error: 'not_found' }, { status: 404 });
    }
    if (row.status !== 'pending' && row.status !== 'missing_recipient') {
      return NextResponse.json(
        {
          error: {
            code: 'wrong_status',
            message: `Pending send is in status "${row.status}" — only "pending" or "missing_recipient" can be approved.`,
          },
        },
        { status: 400 },
      );
    }

    const recipient =
      row.status === 'missing_recipient'
        ? parsedBody.data.recipientOverride ?? null
        : row.proposedRecipient;

    if (!recipient) {
      return NextResponse.json(
        {
          error: {
            code: 'missing_recipient',
            message:
              'No recipient on this pending row — provide recipientOverride in the body.',
          },
        },
        { status: 400 },
      );
    }

    // Build HTML for the configured plain-text body. Same plain-prose
    // treatment as follow-up emails — paragraphs split on blank lines.
    const html = renderEmailLayout({
      preheader: row.proposedSubject,
      eyebrow: `Vera · ${row.rule.name}`,
      headline: row.proposedSubject,
      bodyHtml: bodyToHtml(row.proposedBody),
    });

    const sendResult = await sendEmail({
      to: recipient,
      subject: row.proposedSubject,
      html,
    });

    if (!sendResult.ok) {
      const code =
        sendResult.reason === 'not_configured'
          ? 'email_not_configured'
          : 'send_failed';
      const message =
        sendResult.reason === 'not_configured'
          ? 'Resend is not configured.'
          : sendResult.message;
      await db.pendingRuleSend.update({
        where: { id },
        data: {
          status: 'pending_send_failed',
          reviewedById: audit.userId ?? null,
          reviewedAt: new Date(),
        },
      });
      await recordAudit(db, {
        tenantId: audit.tenantId,
        userId: audit.userId,
        userEmail: audit.userEmail,
        category: 'automation_rules',
        action: 'pending_send_failed',
        entityType: 'PendingRuleSend',
        entityId: String(id),
        summary: `Send failed for rule "${row.rule.name}" to ${recipient}: ${message}`,
        details: {
          ruleId: row.rule.id,
          pendingId: row.id,
          recipient,
          error: { code, message },
        },
      });
      return NextResponse.json(
        { error: { code, message } },
        { status: sendResult.reason === 'not_configured' ? 503 : 502 },
      );
    }

    const sendLog = await withSuppressedAutoAudit(() =>
      db.sendLog.create({
        data: {
          tenantId: audit.tenantId,
          cadence: 'automation',
          toEmails: [recipient],
          resendId: sendResult.id,
          status: 'sent',
        },
      }),
    );

    await db.pendingRuleSend.update({
      where: { id },
      data: {
        status: 'sent',
        sendLogId: sendLog.id,
        reviewedById: audit.userId ?? null,
        reviewedAt: new Date(),
      },
    });

    await recordAudit(db, {
      tenantId: audit.tenantId,
      userId: audit.userId,
      userEmail: audit.userEmail,
      category: 'automation_rules',
      action: 'pending_approved',
      entityType: 'PendingRuleSend',
      entityId: String(id),
      summary: `Approved rule "${row.rule.name}" send to ${recipient}`,
      details: {
        ruleId: row.rule.id,
        pendingId: row.id,
        recipient,
        subject: row.proposedSubject,
        body: row.proposedBody,
        resendId: sendResult.id,
      },
    });

    return NextResponse.json({ ok: true, sendLogId: sendLog.id });
  });
}

function bodyToHtml(plain: string): string {
  const paragraphs = plain
    .replace(/\r\n/g, '\n')
    .split(/\n\s*\n/g)
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
  return paragraphs
    .map((p) => {
      const escaped = escapeEmailHtml(p).replace(/\n/g, '<br>');
      return `<p style="margin:0 0 12px 0;font-size:14px;line-height:1.55;color:${EMAIL_COLORS.textPrimary};">${escaped}</p>`;
    })
    .join('\n');
}
