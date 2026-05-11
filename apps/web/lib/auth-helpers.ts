import 'server-only';
import { NextResponse } from 'next/server';
import { auth } from './auth';
import { withAuditContext, type AuditContext } from './audit-context';

/**
 * Auth + audit-context helper for app routes.
 *
 * Every auth-gated API route is expected to wrap its handler in
 * `withAuth(...)`. The helper does three things at once:
 *
 *   1. Reads the Auth.js session and pulls tenantId/userId/email.
 *   2. Returns a 401 NextResponse if there's no session or the
 *      session lacks a tenant binding.
 *   3. Sets the AsyncLocalStorage audit context so the Prisma
 *      extension can stamp tenantId/userId on auto-logged rows
 *      without the handler having to thread it through.
 *
 * The handler is called with the resolved `AuditContext` so it can use
 * the values directly (e.g. for tenant-scoped queries) without
 * re-reading the session.
 *
 *   export async function PUT(req: Request, ctx: RouteContext) {
 *     return withAuth(async ({ tenantId, userId, userEmail }) => {
 *       const body = await req.json();
 *       const saved = await db.schedule.upsert({ ... });   // auto-audits
 *       return NextResponse.json({ schedule: saved });
 *     });
 *   }
 *
 * Without this wrapper, DB mutations from inside the route skip
 * audit logging (no context to attribute the action to). That's a
 * silent failure mode — see CLAUDE.md "Audit logging" for the rule.
 */
export async function withAuth<T extends Response>(
  handler: (ctx: AuditContext) => Promise<T>,
): Promise<T | NextResponse> {
  const session = await auth();
  if (!session?.user?.email) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const tenantId = session.user.tenantId;
  if (typeof tenantId !== 'number') {
    return NextResponse.json({ error: 'no_tenant_binding' }, { status: 403 });
  }
  const ctx: AuditContext = {
    tenantId,
    userId: typeof session.user.userId === 'number' ? session.user.userId : null,
    userEmail: session.user.email,
  };
  return withAuditContext(ctx, () => handler(ctx));
}
