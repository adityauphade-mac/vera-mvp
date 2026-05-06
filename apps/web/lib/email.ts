import 'server-only';
import { Resend } from 'resend';

export type EmailAttachment = {
  filename: string;
  content: Buffer;
};

export type SendEmailInput = {
  to: string;
  subject: string;
  html: string;
  attachments?: EmailAttachment[];
  /** ISO 8601 UTC timestamp. If absent, sends immediately. */
  scheduledAt?: string;
};

export type SendEmailResult =
  | { ok: true; id: string; scheduledAt: string | null }
  | { ok: false; reason: 'not_configured' }
  | { ok: false; reason: 'send_failed'; message: string };

const FROM = process.env.EMAIL_FROM ?? 'Vera <onboarding@resend.dev>';

let cachedClient: Resend | null = null;
function getClient(): Resend | null {
  const key = process.env.RESEND_API_KEY;
  if (!key) return null;
  if (!cachedClient) cachedClient = new Resend(key);
  return cachedClient;
}

export function isEmailConfigured(): boolean {
  return Boolean(process.env.RESEND_API_KEY);
}

export async function sendEmail(input: SendEmailInput): Promise<SendEmailResult> {
  const client = getClient();
  if (!client) return { ok: false, reason: 'not_configured' };

  const { error, data } = await client.emails.send({
    from: FROM,
    to: input.to,
    subject: input.subject,
    html: input.html,
    attachments: input.attachments?.map((a) => ({
      filename: a.filename,
      content: a.content,
    })),
    ...(input.scheduledAt ? { scheduledAt: input.scheduledAt } : {}),
  });

  if (error || !data) {
    return {
      ok: false,
      reason: 'send_failed',
      message: error?.message ?? 'Unknown send failure',
    };
  }

  return { ok: true, id: data.id, scheduledAt: input.scheduledAt ?? null };
}
