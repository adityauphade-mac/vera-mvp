import { NextResponse } from 'next/server';
import { z } from 'zod';
import { buildDailyBrief } from '@vera/domain';
import { getData } from '@/lib/data';
import { sendEmail, isEmailConfigured } from '@/lib/email';
import { renderDailyBriefPDF } from '@/lib/daily-brief-pdf';

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
  // Lightweight markdown → HTML for email body. We don't need a full parser:
  // just bold, lists, paragraphs, line breaks.
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

  const safeTitle = escape(options.title);
  const safeSubtitle = escape(options.subtitle);

  return `
<!doctype html>
<html>
  <body style="margin:0;padding:24px;background:#FAF6EE;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;color:#1F1B16;">
    <div style="max-width:600px;margin:0 auto;background:#FFFFFF;border:1px solid #E5DDD0;border-radius:12px;padding:32px;">
      <p style="font-size:11px;color:#8A7E6E;text-transform:uppercase;letter-spacing:1.6px;margin:0 0 4px 0;">Vera · Lead AR Intelligence</p>
      <h1 style="font-size:22px;margin:0 0 4px 0;letter-spacing:-0.4px;">${safeTitle}</h1>
      <p style="font-size:12px;color:#5A4F40;margin:0 0 18px 0;">${safeSubtitle}</p>
      <div style="font-size:14px;line-height:1.55;">
        ${out.join('\n')}
      </div>
      <hr style="border:none;border-top:1px solid #E5DDD0;margin:20px 0;" />
      <p style="font-size:11px;color:#8A7E6E;margin:0;">Vera Calloway · Priority Roofs</p>
    </div>
  </body>
</html>`.trim();

  function renderInline(s: string): string {
    // Escape was already done for paragraph content; for list items we escape here.
    const escaped = s.includes('<') ? s : escape(s);
    return escaped.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  }
}

export async function POST(req: Request) {
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

  const { to, sendAt, cadence = 'daily' } = parsed.data;
  const { jobs } = getData();
  const now = new Date();
  const brief = buildDailyBrief(jobs, now, cadence);

  let pdfBuffer: Buffer;
  try {
    pdfBuffer = await renderDailyBriefPDF(brief.data);
  } catch (e) {
    return NextResponse.json(
      {
        error: {
          code: 'pdf_failed',
          message: e instanceof Error ? e.message : 'PDF generation failed',
        },
      },
      { status: 500 },
    );
  }

  const dateStamp = now.toISOString().slice(0, 10); // YYYY-MM-DD
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
      return NextResponse.json(
        { error: { code: 'email_not_configured', message: 'Resend not configured.' } },
        { status: 503 },
      );
    }
    return NextResponse.json(
      { error: { code: 'send_failed', message: result.message } },
      { status: 502 },
    );
  }

  return NextResponse.json({
    id: result.id,
    scheduledFor: result.scheduledAt,
    subject: brief.subject,
    pdfBytes: pdfBuffer.byteLength,
    to,
  });
}
