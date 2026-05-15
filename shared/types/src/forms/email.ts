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

/**
 * Canonical draft-email form schema. Used by both
 *   - the client (RHF + zodResolver) in DraftEmailButton, and
 *   - the server (`/api/follow-ups/send`) — which extends this with route
 *     metadata fields (`jobId`, `jobAddress`, `repName`).
 *
 * The constraints below mirror what the route accepts on the wire so the two
 * ends never drift. `to` / `cc` are capped at 6 (matches the EmailChipInput
 * `max` prop default and the route's prior inline limit); `subject` is capped
 * at 200; `body` is capped at 8000.
 */
export const draftEmailSchema = z.object({
  to: emailListSchema.max(6, { message: 'Up to 6 recipients' }),
  cc: z
    .array(z.string().email({ message: 'Invalid email address' }))
    .max(6, { message: 'Up to 6 cc recipients' }),
  subject: z
    .string()
    .min(1, { message: 'Subject required' })
    .max(200, { message: 'Subject too long' }),
  body: z
    .string()
    .min(1, { message: 'Body required' })
    .max(8000, { message: 'Body too long' }),
});

export type DraftEmailValues = z.infer<typeof draftEmailSchema>;
