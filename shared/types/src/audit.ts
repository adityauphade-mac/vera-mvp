import { z } from 'zod';

/* =============================================================================
 * Audit log catalog
 *
 * Single source of truth for every category/action that can appear in the
 * AuditLog table. The Prisma client extension, the recordAudit helper, the
 * API's Zod validator, and the UI filter dropdowns all read from here.
 *
 * Adding a new category/action: edit this file. That's the entire UI
 * integration — filters, validators, and types update automatically.
 *
 * Adding a new auditable model: see AUDITABLE_MODELS in lib/db.ts.
 * =========================================================================== */

export const AUDIT_CATEGORIES = [
  'auth',
  'schedule',
  'brief',
  'briefing',
  'chat',
] as const;
export type AuditCategory = (typeof AUDIT_CATEGORIES)[number];

/**
 * Allowlist of actions per category. Used by recordAudit and the API
 * to reject typos that would otherwise quietly become orphan rows.
 *
 * Naming convention: snake_case verbs in past tense for completed
 * actions ('signed_in', 'updated'), present-tense neutral verbs for
 * one-off events that don't have a "happened" feel ('asked').
 */
export const AUDIT_ACTIONS_BY_CATEGORY = {
  auth: ['signed_in', 'signed_out', 'user_created'],
  schedule: ['created', 'updated', 'paused', 'resumed', 'deleted'],
  brief: ['sent_now', 'sent_scheduled', 'send_failed'],
  briefing: ['regenerated', 'generated_daily', 'generation_failed'],
  chat: ['asked'],
} as const satisfies Record<AuditCategory, readonly string[]>;

export type AuditAction<C extends AuditCategory = AuditCategory> =
  (typeof AUDIT_ACTIONS_BY_CATEGORY)[C][number];

/** Flat list of every valid action across all categories — for UI filters. */
export const ALL_AUDIT_ACTIONS = Object.values(AUDIT_ACTIONS_BY_CATEGORY).flat();

/**
 * Zod schema for an audit-log row as it comes back from the API. JSON-safe
 * shape (dates as ISO strings, details as unknown).
 */
export const AuditLogSchema = z.object({
  id: z.number(),
  tenantId: z.number(),
  userId: z.number().nullable(),
  userEmail: z.string().nullable(),
  category: z.enum(AUDIT_CATEGORIES),
  action: z.string(),
  entityType: z.string().nullable(),
  entityId: z.string().nullable(),
  summary: z.string(),
  details: z.unknown().nullable(),
  createdAt: z.string(),
});
export type AuditLogEntry = z.infer<typeof AuditLogSchema>;

/** Query params accepted by GET /api/audit-logs. */
export const AuditLogQuerySchema = z.object({
  category: z.enum(AUDIT_CATEGORIES).optional(),
  action: z.string().optional(),
  userId: z.coerce.number().int().nullable().optional(),
  entityType: z.string().optional(),
  entityId: z.string().optional(),
  /** ISO timestamp (inclusive lower bound). */
  since: z.string().datetime({ offset: true }).optional(),
  /** ISO timestamp (exclusive upper bound). */
  until: z.string().datetime({ offset: true }).optional(),
  /** Case-insensitive substring search over `summary`. */
  q: z.string().min(1).max(200).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});
export type AuditLogQuery = z.infer<typeof AuditLogQuerySchema>;

/**
 * Human-readable labels for the UI. Keep these in sync with the
 * catalog above — adding a new category/action means adding a label
 * here too. The audit-log table cells and the detail sheet both read
 * from these maps.
 */
export const AUDIT_CATEGORY_LABEL: Record<AuditCategory, string> = {
  auth: 'Auth',
  schedule: 'Schedule',
  brief: 'Brief',
  briefing: 'Briefing',
  chat: 'Chat',
};

/**
 * Verb labels per category. Slightly contextual so the operator
 * reading the column doesn't see ambiguous past tenses:
 *
 *   - `brief.sent_now`      → "Sent (manual)"
 *   - `brief.sent_scheduled`→ "Sent (scheduled)"
 *   - `chat.asked`          → "Asked"
 *
 * Falls back to a Title Case version of the raw action string when
 * an entry is missing — so forward-compat for new actions doesn't
 * silently regress UI quality.
 */
const ACTION_LABELS: Record<string, string> = {
  // auth
  signed_in: 'Signed in',
  signed_out: 'Signed out',
  user_created: 'User created',
  // schedule
  created: 'Created',
  updated: 'Updated',
  paused: 'Paused',
  resumed: 'Resumed',
  deleted: 'Deleted',
  // brief
  sent_now: 'Sent (manual)',
  sent_scheduled: 'Sent (scheduled)',
  send_failed: 'Send failed',
  // briefing
  regenerated: 'Regenerated',
  generated_daily: 'Generated (daily)',
  generation_failed: 'Generation failed',
  // chat
  asked: 'Asked',
};

export function humanizeAction(action: string): string {
  const hit = ACTION_LABELS[action];
  if (hit) return hit;
  // Fallback: snake_case → "Snake case" → "Snake Case"
  return action
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

export function humanizeCategory(category: AuditCategory | string): string {
  if (category in AUDIT_CATEGORY_LABEL) {
    return AUDIT_CATEGORY_LABEL[category as AuditCategory];
  }
  return category.charAt(0).toUpperCase() + category.slice(1);
}

/**
 * Shape of a recordAudit() call. The Prisma extension also builds this
 * shape internally for auto-logged rows.
 */
export const AuditWriteSchema = z.object({
  tenantId: z.number().int(),
  userId: z.number().int().nullable().optional(),
  userEmail: z.string().nullable().optional(),
  category: z.enum(AUDIT_CATEGORIES),
  action: z.string(),
  entityType: z.string().nullable().optional(),
  entityId: z.string().nullable().optional(),
  summary: z.string(),
  details: z.unknown().optional(),
});
export type AuditWriteInput = z.infer<typeof AuditWriteSchema>;
