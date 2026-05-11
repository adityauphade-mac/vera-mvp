import 'server-only';
import { AsyncLocalStorage } from 'node:async_hooks';

/**
 * Request-scoped audit context.
 *
 * The Prisma client extension at `lib/db.ts` looks up `getAuditContext()`
 * to find the tenantId/userId it should stamp on auto-logged rows.
 * Without a context, the extension skips audit writes — that's the
 * correct behavior for code paths outside an HTTP request (Prisma seed,
 * standalone scripts, build-time tasks).
 *
 * Two ways to populate the context:
 *   - `withAuth()` in `lib/auth-helpers.ts` — for auth-gated routes.
 *   - `withSystemAuditContext()` here — for cron handlers and any
 *     non-user-triggered work that still needs auditing.
 *
 * Auth.js event callbacks (`events.signIn`, `events.signOut`) do NOT
 * use this — they call `recordAudit()` directly with explicit values,
 * because the auth flow happens BEFORE any of our route helpers run.
 */

export interface AuditContext {
  tenantId: number;
  /** null for system-triggered actions (cron, scripts). */
  userId: number | null;
  userEmail: string | null;
  /**
   * When true, the Prisma client extension's auto-audit path skips
   * writing a generic row for mutations inside this block. The route
   * is expected to call recordAudit() with a pretty custom summary
   * instead. Use via `withSuppressedAutoAudit()`.
   */
  suppressAutoAudit?: boolean;
}

const storage = new AsyncLocalStorage<AuditContext>();

/** Run `fn` with the given audit context bound to the request. */
export function withAuditContext<T>(ctx: AuditContext, fn: () => T): T {
  return storage.run(ctx, fn);
}

/**
 * System-action context. Use inside cron loops to attribute writes to
 * the right tenant while keeping `userId = null` so the UI can filter
 * by "system" vs user activity.
 *
 *   await withSystemAuditContext({ tenantId }, async () => {
 *     await db.briefing.create(...) // auto-audits with userId=null
 *   });
 */
export function withSystemAuditContext<T>(
  args: { tenantId: number },
  fn: () => T,
): T {
  return storage.run(
    { tenantId: args.tenantId, userId: null, userEmail: null },
    fn,
  );
}

/** Read the current audit context, if any. Returns undefined outside a request. */
export function getAuditContext(): AuditContext | undefined {
  return storage.getStore();
}

/**
 * Run `fn` with auto-audit suppressed. Mutations inside the block do NOT
 * trigger the Prisma extension's generic-summary write. Use when the
 * route writes its own custom audit row via `recordAudit()` and doesn't
 * want a duplicate generic entry.
 *
 *   await withSuppressedAutoAudit(async () => {
 *     const saved = await db.schedule.upsert({ ... });
 *     await recordAudit({ category: 'schedule', action: 'paused', ... });
 *   });
 *
 * No-op if there's no existing audit context — the extension would skip
 * anyway in that case.
 */
export function withSuppressedAutoAudit<T>(fn: () => Promise<T>): Promise<T> {
  const current = storage.getStore();
  if (!current) return fn();
  return storage.run({ ...current, suppressAutoAudit: true }, fn);
}
