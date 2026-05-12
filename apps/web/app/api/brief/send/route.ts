import { NextResponse } from 'next/server';
import { z } from 'zod';
import { buildDailyBrief } from '@vera/domain';
import { getData } from '@/lib/data';
import { sendEmail, isEmailConfigured } from '@/lib/email';
import { renderDailyBriefPDF } from '@/lib/daily-brief-pdf';
import { renderEmailLayout, EMAIL_COLORS } from '@/lib/email-layout';

export const runtime = 'nodejs';
export const maxDuration = 30;

const RequestSchema = z.object({
  to: z.string().email(),
  /** ISO 8601 UTC timestamp, must be in the future. Absent = send now. */
  sendAt: z
    .string()
    .datetime({ offset: true })
    .refine((s) => new Date(s).getTime() > Date.now(), {
      message: 'sendAt must be in the future',
    })
    .optional(),
  cadence: z.enum(['daily', 'weekly', 'monthly']).optional(),
});

function markdownToHtml(
  md: string,
  options: { title: string; subtitle: string },
): string {
  // Lightweight markdown → HTML for the brief body. The outer email
  // chrome (header with Vera avatar + Calloway name, footer) is supplied
  // by `renderEmailLayout`. We only build the inner body here: an intro
  // subtitle line plus the converted markdown.
  const escape = (s: string) =>
    s
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');

  const lines = md.split('\n');
  const out: string[] = [];
  let inList = false;
  for (const raw of lines) {
    const line = raw;
    if (line.startsWith('- ')) {
      if (!inList) {
        out.push('<ul style="margin:8px 0 12px 0;padding-left:20px;">');
        inList = true;
      }
      const content = renderInline(line.slice(2));
      out.push(`<li style="margin-bottom:4px;">${content}</li>`);
    } else if (line.trim() === '') {
      if (inList) {
        out.push('</ul>');
        inList = false;
      }
      out.push('');
    } else {
      if (inList) {
        out.push('</ul>');
        inList = false;
      }
      out.push(`<p style="margin:0 0 10px 0;">${renderInline(escape(line))}</p>`);
    }
  }
  if (inList) out.push('</ul>');

  const bodyHtml = `
    <div style="font-size:14px;line-height:1.55;color:${EMAIL_COLORS.textPrimary};">
      ${out.join('\n')}
    </div>`.trim();

  return renderEmailLayout({
    preheader: options.subtitle,
    eyebrow: 'Vera · daily AR brief',
    headline: options.title,
    introHtml: escape(options.subtitle),
    bodyHtml,
  });

  function renderInline(s: string): string {
    // Escape was already done for paragraph content; for list items we escape here.
    const escaped = s.includes('<') ? s : escape(s);
    return escaped.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  }
}

/**
 * Build + send a brief in-process. Used by both the HTTP route below and
 * the cron dispatcher (which avoids the HTTP roundtrip + Vercel deployment
 * protection on hashed preview URLs).
 */
export type SendBriefInput = {
  to: string;
  sendAt?: string;
  cadence?: 'daily' | 'weekly' | 'monthly';
};

export type SendBriefResult =
  | {
      ok: true;
      id: string;
      scheduledFor: string | null;
      subject: string;
      pdfBytes: number;
    }
  | {
      ok: false;
      status: number;
      code: string;
      message: string;
    };

export async function sendBrief(input: SendBriefInput): Promise<SendBriefResult> {
  if (!isEmailConfigured()) {
    return {
      ok: false,
      status: 503,
      code: 'email_not_configured',
      message: 'Resend is not configured. Set RESEND_API_KEY in the environment.',
    };
  }

  const { to, sendAt, cadence = 'daily' } = input;
  const { jobs } = getData();
  const now = new Date();
  const brief = buildDailyBrief(jobs, now, cadence);

  let pdfBuffer: Buffer;
  try {
    pdfBuffer = await renderDailyBriefPDF(brief.data);
  } catch (e) {
    return {
      ok: false,
      status: 500,
      code: 'pdf_failed',
      message: e instanceof Error ? e.message : 'PDF generation failed',
    };
  }

  const dateStamp = now.toISOString().slice(0, 10);
  const filename = `vera-${cadence}-ar-brief-${dateStamp}.pdf`;

  const result = await sendEmail({
    to,
    subject: brief.subject,
    html: markdownToHtml(brief.markdown, {
      title: brief.data.briefTitle,
      subtitle: brief.data.briefSubtitle,
    }),
    attachments: [{ filename, content: pdfBuffer }],
    scheduledAt: sendAt,
  });

  if (!result.ok) {
    if (result.reason === 'not_configured') {
      return {
        ok: false,
        status: 503,
        code: 'email_not_configured',
        message: 'Resend not configured.',
      };
    }
    return {
      ok: false,
      status: 502,
      code: 'send_failed',
      message: result.message,
    };
  }

  return {
    ok: true,
    id: result.id,
    scheduledFor: result.scheduledAt,
    subject: brief.subject,
    pdfBytes: pdfBuffer.byteLength,
  };
}

export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { error: { code: 'invalid_json', message: 'Body must be valid JSON.' } },
      { status: 400 },
    );
  }

  const parsed = RequestSchema.safeParse(body);
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

  const result = await sendBrief(parsed.data);

  if (!result.ok) {
    return NextResponse.json(
      { error: { code: result.code, message: result.message } },
      { status: result.status },
    );
  }

  return NextResponse.json({
    id: result.id,
    scheduledFor: result.scheduledFor,
    subject: result.subject,
    pdfBytes: result.pdfBytes,
    to: parsed.data.to,
  });
}
