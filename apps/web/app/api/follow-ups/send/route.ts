import { NextResponse } from 'next/server';
import { z } from 'zod';
import { draftEmailSchema } from '@vera/types';
import { sendEmail, isEmailConfigured } from '@/lib/email';
import { withAuth } from '@/lib/auth-helpers';
import { recordAudit } from '@/lib/audit';
import { db } from '@/lib/db';
import {
  renderEmailLayout,
  EMAIL_COLORS,
  escapeEmailHtml,
} from '@/lib/email-layout';

export const runtime = 'nodejs';
export const maxDuration = 30;

/**
 * Route schema = the shared client/server draft-email schema extended with
 * the route's own metadata fields (`jobId`, `jobAddress`, `repName`). The
 * shared schema (`draftEmailSchema` in @vera/types) is the source of truth
 * for to/cc/subject/body constraints — both this route and the
 * `DraftEmailButton` RHF form resolve against it, so they can never drift.
 *
 * Server-side hardening on top of the shared schema:
 *   - normalize each recipient via trim + lowercase + dedupe (the chip input
 *     already does this, but the server stays defensive).
 */
const normalizeEmailList = (arr: string[]) =>
  Array.from(new Set(arr.map((s) => s.trim().toLowerCase()))).filter(Boolean);

const RequestSchema = draftEmailSchema
  .extend({
    jobId: z.union([z.number().int(), z.string().min(1)]),
    jobAddress: z.string().min(1).max(200),
    repName: z.string().min(1).max(120),
  })
  .transform((data) => ({
    ...data,
    to: normalizeEmailList(data.to),
    cc: normalizeEmailList(data.cc),
  }))
  .refine((data) => data.to.length >= 1, {
    message: 'Add at least one recipient',
    path: ['to'],
  });

/**
 * Render the plain-text follow-up body into HTML that lives inside the
 * shared Vera email layout. Splits on blank lines into paragraphs, escapes
 * every char, preserves single newlines as <br>. No markdown — follow-up
 * drafts from `generateFollowUpDraft` are plain prose, and the user edits
 * the body as plain text in the compose modal.
 */
function bodyToHtml(plain: string): string {
  const paragraphs = plain
    .replace(/\r\n/g, '\n')
    .split(/\n\s*\n/g)
    .map((p) => p.trim())
    .filter((p) => p.length > 0);

  const paras = paragraphs
    .map((p) => {
      const escaped = escapeEmailHtml(p).replace(/\n/g, '<br>');
      return `<p style="margin:0 0 12px 0;font-size:14px;line-height:1.55;color:${EMAIL_COLORS.textPrimary};">${escaped}</p>`;
    })
    .join('\n');

  return `<div>${paras}</div>`;
}

export async function POST(req: Request) {
  return withAuth(async (audit) => {
    if (!isEmailConfigured()) {
      return NextResponse.json(
        {
          error: {
            code: 'email_not_configured',
            message:
              'Resend is not configured. Set RESEND_API_KEY in the environment.',
          },
        },
        { status: 503 },
      );
    }

    let raw: unknown;
    try {
      raw = await req.json();
    } catch {
      return NextResponse.json(
        { error: { code: 'invalid_json', message: 'Body must be valid JSON.' } },
        { status: 400 },
      );
    }

    const parsed = RequestSchema.safeParse(raw);
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

    const { jobId, jobAddress, repName, to, cc, subject, body } = parsed.data;

    const ccOnlyClean = cc.filter((addr) => !to.includes(addr));

    const html = renderEmailLayout({
      preheader: subject,
      eyebrow: 'Vera · follow-up',
      headline: subject,
      bodyHtml: bodyToHtml(body),
    });

    const result = await sendEmail({
      to,
      cc: ccOnlyClean.length > 0 ? ccOnlyClean : undefined,
      subject,
      html,
    });

    const toSummary = to.length === 1 ? to[0] : `${to.length} recipients`;
    const ccSummary = ccOnlyClean.length > 0 ? ` (cc ${ccOnlyClean.length})` : '';

    if (!result.ok) {
      const code = result.reason === 'not_configured' ? 'email_not_configured' : 'send_failed';
      const message =
        result.reason === 'not_configured'
          ? 'Resend not configured.'
          : result.message;

      await recordAudit(db, {
        tenantId: audit.tenantId,
        userId: audit.userId,
        userEmail: audit.userEmail,
        category: 'follow_up',
        action: 'send_failed',
        entityType: 'Job',
        entityId: String(jobId),
        summary: `Follow-up for ${jobAddress} (${repName}) to ${toSummary}${ccSummary} failed: ${code}`,
        details: {
          jobId,
          jobAddress,
          repName,
          to,
          cc: ccOnlyClean,
          subject,
          body,
          error: { code, message },
        },
      });

      return NextResponse.json(
        { error: { code, message } },
        { status: result.reason === 'not_configured' ? 503 : 502 },
      );
    }

    await recordAudit(db, {
      tenantId: audit.tenantId,
      userId: audit.userId,
      userEmail: audit.userEmail,
      category: 'follow_up',
      action: 'sent',
      entityType: 'Job',
      entityId: String(jobId),
      summary: `Sent follow-up for ${jobAddress} (${repName}) to ${toSummary}${ccSummary}`,
      details: {
        jobId,
        jobAddress,
        repName,
        to,
        cc: ccOnlyClean,
        subject,
        body,
        resendId: result.id,
      },
    });

    return NextResponse.json({
      id: result.id,
      to,
      cc: ccOnlyClean,
      subject,
    });
  });
}
