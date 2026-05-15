import { z } from 'zod';

/**
 * Shared email-form schemas. Imported by both client (RHF resolver) and server
 * (route input validation) so the same validation rules apply at both ends.
 *
 * Lifted from the inline schema in apps/web/app/api/follow-ups/send/route.ts.
 * Phase A-2 replaces that inline schema with `draftEmailSchema` here.
 */

export const emailListSchema = z
  .array(z.string().email())
  .min(1, { message: 'At least one recipient required' });

export const draftEmailSchema = z.object({
  to: emailListSchema,
  cc: z.array(z.string().email()),
  subject: z.string().min(1, { message: 'Subject required' }).max(998),
  body: z.string().min(1, { message: 'Body required' }),
});

export type DraftEmailValues = z.infer<typeof draftEmailSchema>;
