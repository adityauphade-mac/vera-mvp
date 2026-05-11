import 'server-only';
import { Prisma, type PrismaClient } from '@prisma/client';
import type { AuditCategory } from '@vera/types';
import { getAuditContext } from './audit-context';

/**
 * Structural type for a Prisma-like client. Both the raw `PrismaClient`
 * and the extended client returned by `$extends` satisfy this — TS
 * widens the extended type just enough that the plain `PrismaClient`
 * type wouldn't accept it. Accepting any object with the bits we use
 * keeps the helper callable from both.
 */
type AuditCapableClient = {
  auditLog: {
    create: (args: {
      data: Prisma.AuditLogUncheckedCreateInput;
    }) => Promise<unknown>;
  };
};

/**
 * Audit logging — both the explicit `recordAudit()` helper and the
 * Prisma client extension that auto-audits mutations.
 *
 * See CLAUDE.md "Audit logging" for the integration contract.
 */

// ---------------------------------------------------------------------------
// Auditable model registry
// ---------------------------------------------------------------------------

/**
 * Prisma models whose mutations the extension auto-logs.
 *
 * Currently empty by design. Every V1 surface (schedules, briefings,
 * sends, chat, auth) already calls `recordAudit()` explicitly so it
 * can emit a pretty human-readable summary. Auto-audit would only
 * produce a duplicate generic row alongside the pretty one.
 *
 * The extension stays wired in so that future features which DON'T
 * need a custom summary can opt in with a one-line change here. Add
 * the model name to this set and any `create / update / upsert /
 * delete / *Many` operation on it auto-logs.
 *
 * Why not "auto-log everything by default"? Prisma client extensions
 * don't reliably propagate AsyncLocalStorage frames into their
 * `$allOperations` callback — the suppress flag we'd need to skip
 * auto-audit when the route does its own explicit `recordAudit`
 * doesn't survive into the extension. Until that's fixed upstream,
 * the safer pattern is: explicit calls everywhere, auto-audit only
 * for genuinely generic surfaces.
 */
const AUDITABLE_MODELS = new Set<string>([
  // (intentionally empty for V1 — see comment above)
]);

/**
 * Map Prisma model name → audit category. Drives the `category` column
 * of auto-logged rows.
 */
const MODEL_CATEGORY: Record<string, AuditCategory> = {
  Schedule: 'schedule',
  Briefing: 'briefing',
  SendLog: 'brief',
};

/**
 * Prisma operation → audit action verb. The verb is what the table
 * cell shows: 'created', 'updated', etc. Bulk operations get a
 * '*_bulk' suffix so the operator can filter them out of the noisy
 * audit table when wanted.
 */
const OP_ACTION: Record<string, string> = {
  create: 'created',
  createMany: 'created_bulk',
  update: 'updated',
  updateMany: 'updated_bulk',
  upsert: 'updated',
  delete: 'deleted',
  deleteMany: 'deleted_bulk',
};

const MUTATION_OPS = new Set(Object.keys(OP_ACTION));

// ---------------------------------------------------------------------------
// Public recordAudit
// ---------------------------------------------------------------------------

interface RecordAuditInput {
  tenantId: number;
  userId?: number | null;
  userEmail?: string | null;
  category: AuditCategory;
  action: string;
  entityType?: string | null;
  entityId?: string | null;
  summary: string;
  details?: unknown;
}

/**
 * Explicitly write an audit row. Use for:
 *   - Non-DB events (auth callbacks, chat messages, etc).
 *   - Custom human-readable summaries on top of auto-logged mutations
 *     (combine with `withSuppressedAutoAudit()` to avoid the duplicate
 *     generic row).
 *
 * Never throws. Audit-write failures log to stderr and are swallowed
 * so they don't propagate into the user's request and break the
 * actual action.
 *
 * Uses the raw Prisma client (avoiding the extension) to skip the
 * auto-audit recursion path.
 */
export async function recordAudit(
  db: AuditCapableClient,
  input: RecordAuditInput,
): Promise<void> {
  try {
    await db.auditLog.create({
      data: {
        tenantId: input.tenantId,
        userId: input.userId ?? null,
        userEmail: input.userEmail ?? null,
        category: input.category,
        action: input.action,
        entityType: input.entityType ?? null,
        entityId: input.entityId ?? null,
        summary: input.summary,
        details: (input.details ?? Prisma.JsonNull) as Prisma.InputJsonValue,
      },
    });
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error('[audit] failed to write audit row:', e, 'input:', input);
  }
}

// ---------------------------------------------------------------------------
// Prisma client extension — auto-audit
// ---------------------------------------------------------------------------

/**
 * Build a generic human-readable summary for an auto-logged mutation.
 * The route can override by suppressing auto-audit and calling
 * recordAudit with a prettier line.
 */
function buildAutoSummary(
  model: string,
  action: string,
  result: unknown,
): string {
  // For single-row operations, include the id if we can see it.
  const id =
    result && typeof result === 'object' && 'id' in result
      ? String((result as { id: unknown }).id)
      : null;
  if (id) return `${model} #${id} ${action.replace('_bulk', '')}`;
  return `${model} ${action}`;
}

/**
 * Extract a usable entityId from a mutation result. Best-effort — we
 * just want a string we can index on. Returns null when the operation
 * doesn't yield a single identifiable row (deleteMany, etc).
 */
function extractEntityId(result: unknown): string | null {
  if (result && typeof result === 'object' && 'id' in result) {
    const id = (result as { id: unknown }).id;
    if (typeof id === 'string' || typeof id === 'number') return String(id);
  }
  return null;
}

/**
 * The audit-log Prisma extension. Wraps every mutation on an
 * auditable model and writes a generic AuditLog row after the mutation
 * succeeds.
 *
 * Skips when:
 *   - The model isn't in AUDITABLE_MODELS.
 *   - The operation isn't a mutation (find*, count, aggregate, etc).
 *   - No audit context is set (running outside an HTTP request — seed,
 *     migration, standalone script).
 *   - The current context has `suppressAutoAudit: true` (route is
 *     handling its own audit explicitly).
 *
 * Audit-write failures are caught and logged to console.error; they
 * never propagate into the user's request.
 *
 * The extension uses a SEPARATE PrismaClient instance for the actual
 * audit write so we don't recurse back through this same extension.
 */
export function auditExtensionFactory(rawClient: PrismaClient & AuditCapableClient) {
  return Prisma.defineExtension({
    name: 'audit-log',
    query: {
      $allModels: {
        async $allOperations({ model, operation, args, query }) {
          const result = await query(args);

          if (!model || !AUDITABLE_MODELS.has(model)) return result;
          if (!MUTATION_OPS.has(operation)) return result;

          const ctx = getAuditContext();
          if (!ctx) return result;
          if (ctx.suppressAutoAudit) return result;

          const category = MODEL_CATEGORY[model];
          const action = OP_ACTION[operation];
          if (!category || !action) return result;

          // Fire-and-forget pattern: we await it so failures surface in
          // the same request, but the recordAudit body catches its own
          // errors so this never throws.
          await recordAudit(rawClient, {
            tenantId: ctx.tenantId,
            userId: ctx.userId,
            userEmail: ctx.userEmail,
            category,
            action,
            entityType: model,
            entityId: extractEntityId(result),
            summary: buildAutoSummary(model, action, result),
            details: { operation, args: sanitizeArgs(args) },
          });

          return result;
        },
      },
    },
  });
}

/**
 * Strip noisy / huge fields from operation args before serialising into
 * `details.args`. We don't need the entire body of a Briefing's
 * `bodyMd` cluttering audit JSON; the summary + the entityId are
 * enough to look up the full row if anyone wants it.
 */
function sanitizeArgs(args: unknown): unknown {
  if (!args || typeof args !== 'object') return args;
  // Shallow copy so we don't mutate the caller's object.
  const out: Record<string, unknown> = { ...(args as Record<string, unknown>) };
  if ('data' in out && typeof out.data === 'object' && out.data) {
    const data = { ...(out.data as Record<string, unknown>) };
    for (const huge of ['bodyMd', 'keyJobs', 'pdfBytes']) {
      if (huge in data) data[huge] = '[redacted]';
    }
    out.data = data;
  }
  return out;
}
