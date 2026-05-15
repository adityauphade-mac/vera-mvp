import { z } from 'zod';

/**
 * Shared backfill-schedule form schema. Used by:
 *  - The DataSyncSection form (RHF + zodResolver) on the client.
 *  - The /api/backfills/[source]/schedule route as the canonical input
 *    shape after the form's `toWireBody` transform runs.
 *
 * Form values store dayOfWeek / dayOfMonth as strings because the underlying
 * <Select> components emit strings — the route accepts the same shape with
 * dayOfWeek as a number, so the client transforms before POSTing
 * (see toBackfillScheduleWireBody below).
 */

const time = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, { message: 'Use HH:mm' });

const recipients = z
  .array(z.string().email({ message: 'Invalid email address' }))
  .min(1, { message: 'Add at least one notification recipient' })
  .max(6, { message: 'Up to 6 recipients' });

export const backfillScheduleFormSchema = z.object({
  cadence: z.enum(['daily', 'weekly', 'monthly']),
  dayOfWeek: z.string().regex(/^[0-6]$/),
  dayOfMonth: z.union([
    z.literal('last'),
    z.literal('last-business'),
    z.string().regex(/^\d{1,2}$/),
  ]),
  timeLocal: time,
  recipients,
});

export type BackfillScheduleFormValues = z.infer<
  typeof backfillScheduleFormSchema
>;

/**
 * Wire-shape schema the API route validates against — derived from the form
 * shape by collapsing dayOfWeek/dayOfMonth to nullables per the chosen
 * cadence, and adding tz + enabled (which live outside the form).
 */
export const backfillScheduleWireSchema = z.object({
  cadence: z.enum(['daily', 'weekly', 'monthly']),
  dayOfWeek: z.number().int().min(0).max(6).nullable().optional(),
  dayOfMonth: z.string().nullable().optional(),
  timeLocal: time,
  timezone: z.string().min(1),
  recipients: recipients.transform((arr) =>
    Array.from(new Set(arr.map((s) => s.trim().toLowerCase()))),
  ),
  enabled: z.boolean().default(true),
});

export type BackfillScheduleWireValues = z.infer<
  typeof backfillScheduleWireSchema
>;

/**
 * Transform RHF form values + the surrounding `timezone` + `enabled` flag into
 * the wire shape the API route expects.
 */
export function toBackfillScheduleWireBody(args: {
  form: BackfillScheduleFormValues;
  timezone: string;
  enabled: boolean;
}): BackfillScheduleWireValues {
  const { form, timezone, enabled } = args;
  return {
    cadence: form.cadence,
    dayOfWeek: form.cadence === 'weekly' ? Number(form.dayOfWeek) : null,
    dayOfMonth: form.cadence === 'monthly' ? form.dayOfMonth : null,
    timeLocal: form.timeLocal,
    timezone,
    recipients: Array.from(
      new Set(form.recipients.map((s) => s.trim().toLowerCase())),
    ),
    enabled,
  };
}
