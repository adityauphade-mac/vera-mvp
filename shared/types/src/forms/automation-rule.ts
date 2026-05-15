import { z } from 'zod';

/**
 * Shared schema for the automation-rule editor (RHF on the client) and the
 * /api/automation-rules POST/PUT body validators (server). Same shape both
 * ends — Add a field once, both sides see it.
 *
 * The three numeric metrics map to ARJob fields in the evaluator:
 *   aging_days → daysPastTerms
 *   balance    → balance
 *   heat_score → heatScore
 *
 * Operators (decided in DISCUSSION.md §7):
 *   crosses_above:        was below threshold, now ≥ threshold → fires once
 *   crosses_below:        was ≥ threshold, now below → fires once
 *   stays_above_for_n_days: ≥ threshold continuously for N days
 *
 * Recipient model:
 *   assigned_rep: pulled from ARJob.rep.email at fire time. Falls back to
 *                 status='missing_recipient' if no email is on file.
 *   fixed_email:  populate recipientEmail on the rule.
 */

export const METRIC_VALUES = ['aging_days', 'balance', 'heat_score'] as const;
export type RuleMetric = (typeof METRIC_VALUES)[number];

export const OPERATOR_VALUES = [
  'crosses_above',
  'crosses_below',
  'stays_above_for_n_days',
] as const;
export type RuleOperator = (typeof OPERATOR_VALUES)[number];

export const RECIPIENT_MODE_VALUES = ['assigned_rep', 'fixed_email'] as const;
export type RuleRecipientMode = (typeof RECIPIENT_MODE_VALUES)[number];

export const automationRuleSchema = z
  .object({
    name: z.string().min(1, 'Rule name required').max(80),
    metric: z.enum(METRIC_VALUES),
    operator: z.enum(OPERATOR_VALUES),
    threshold: z.number().finite(),
    /** Required when operator = stays_above_for_n_days, ignored otherwise. */
    thresholdDays: z.number().int().positive().nullable(),
    recipientMode: z.enum(RECIPIENT_MODE_VALUES),
    /** Required when recipientMode = fixed_email. */
    recipientEmail: z
      .string()
      .email('Invalid email address')
      .nullable(),
    subjectTemplate: z
      .string()
      .min(1, 'Subject required')
      .max(200),
    bodyTemplate: z.string().min(1, 'Body required').max(8000),
    dailySendCap: z.number().int().positive().max(500).default(25),
    enabled: z.boolean().default(true),
  })
  .refine(
    (v) => v.operator !== 'stays_above_for_n_days' || v.thresholdDays !== null,
    {
      message: 'thresholdDays required when operator is stays_above_for_n_days',
      path: ['thresholdDays'],
    },
  )
  .refine(
    (v) => v.recipientMode !== 'fixed_email' || v.recipientEmail !== null,
    {
      message: 'recipientEmail required when recipientMode is fixed_email',
      path: ['recipientEmail'],
    },
  );

export type AutomationRuleValues = z.infer<typeof automationRuleSchema>;

/**
 * Wire schema for the pending-send approve route. Lets the user override the
 * proposed recipient when the rule was authored as assigned_rep but the
 * assigned rep has no email on file (status = missing_recipient).
 */
export const approvePendingSendSchema = z.object({
  recipientOverride: z
    .string()
    .email('Invalid email address')
    .nullable()
    .optional(),
});
export type ApprovePendingSendValues = z.infer<typeof approvePendingSendSchema>;

export const rejectPendingSendSchema = z.object({
  reason: z.string().max(200).optional(),
});
export type RejectPendingSendValues = z.infer<typeof rejectPendingSendSchema>;
