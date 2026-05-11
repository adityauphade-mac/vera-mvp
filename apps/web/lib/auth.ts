import NextAuth from 'next-auth';
import { authConfig } from '@/lib/auth.config';
import { db } from '@/lib/db';
import { recordAudit } from '@/lib/audit';

/**
 * Auth.js v5 configuration. Google provider, JWT session strategy (avoids
 * needing a Prisma adapter just yet — sessions live in cookies), with a
 * custom signIn callback that:
 *   - Looks up or auto-creates a `User` row for the signed-in Google account
 *   - Binds it to Priority Roofs Dallas (tenantId=1) for v1 since we're
 *     single-tenant. Future tenants will get added through a team-onboarding
 *     flow, not here.
 *   - Stores the resolved userId, tenantId, and role on the JWT so the
 *     session callback can hand them to the rest of the app.
 *
 * Whitelist policy: open. Any signed-in Google account is admitted on first
 * sign-in. Per IMPROVEMENTS.md §2.4, this is fine for v1; tighten to a
 * domain rule when going wider.
 */

const TENANT_ID_FALLBACK = 1;

// Wrap the destructure so TypeScript infers a non-portable type name from
// our re-exports. Auth.js v5 has known TS inference quirks in monorepo
// workspaces; this pattern sidesteps them.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const _nextAuth: any = NextAuth({
  ...authConfig,
  callbacks: {
    async signIn({ user, account }) {
      if (!user.email) return false;
      // Find or create the user row, bind to default tenant.
      try {
        const existing = await db.user.findUnique({
          where: { email: user.email },
        });
        if (!existing) {
          const created = await db.user.create({
            data: {
              email: user.email,
              name: user.name ?? null,
              imageUrl: user.image ?? null,
              googleSub: account?.providerAccountId ?? null,
              tenantId: TENANT_ID_FALLBACK,
              role: 'member',
            },
          });
          // JWT strategy doesn't fire events.createUser, so we audit
          // the new user here. The signed_in audit fires next.
          await recordAudit(db, {
            tenantId: created.tenantId,
            userId: created.id,
            userEmail: created.email,
            category: 'auth',
            action: 'user_created',
            summary: `New user: ${created.email}`,
            details: { provider: account?.provider },
          });
        } else if (!existing.googleSub && account?.providerAccountId) {
          await db.user.update({
            where: { id: existing.id },
            data: {
              googleSub: account.providerAccountId,
              name: user.name ?? existing.name,
              imageUrl: user.image ?? existing.imageUrl,
            },
          });
        }
      } catch (e) {
        // DB not yet provisioned — log and let sign-in proceed; the session
        // will lack tenantId until DATABASE_URL is set, but auth still works.
        // eslint-disable-next-line no-console
        console.warn('[auth] user upsert failed:', e);
      }
      return true;
    },
    async jwt({ token, user }) {
      // Refresh tenantId/userId from DB on initial sign-in.
      if (user?.email) {
        try {
          const row = await db.user.findUnique({
            where: { email: user.email },
          });
          if (row) {
            token.userId = row.id;
            token.tenantId = row.tenantId;
            token.role = row.role;
          }
        } catch {
          /* DB not provisioned — leave token without tenantId */
        }
      }
      return token;
    },
    async session({ session, token }: { session: any; token: any }) {
      if (session.user) {
        session.user.userId = token.userId as number | undefined;
        session.user.tenantId = token.tenantId as number | undefined;
        session.user.role = token.role as string | undefined;
      }
      return session;
    },
  },
  /**
   * Audit events. The callbacks above can't reliably write audit rows
   * because the AsyncLocalStorage audit context isn't set during the
   * auth flow itself — there's no `withAuth` wrapper yet. So we use
   * explicit `recordAudit` calls with the tenantId looked up directly
   * from the just-created/updated User row.
   *
   * `signOut` fires server-side when the session is destroyed (cookie
   * cleared). Auth.js v5 provides `token` on the event payload.
   */
  events: {
    async signIn({ user, account, isNewUser }: any) {
      if (!user?.email) return;
      try {
        const row = await db.user.findUnique({ where: { email: user.email } });
        if (!row) return;
        await recordAudit(db, {
          tenantId: row.tenantId,
          userId: row.id,
          userEmail: row.email,
          category: 'auth',
          action: 'signed_in',
          summary: `Signed in via ${account?.provider ?? 'unknown'}`,
          details: { provider: account?.provider, isNewUser },
        });
      } catch (e) {
        // eslint-disable-next-line no-console
        console.warn('[auth] signed_in audit failed:', e);
      }
    },
    async signOut(args: any) {
      // Auth.js v5 events.signOut payload shape varies by strategy.
      // JWT strategy gives us { token }; database strategy gives
      // { session }. Pull email out of whichever is present.
      const email =
        args?.token?.email ??
        args?.session?.user?.email ??
        null;
      if (!email) return;
      try {
        const row = await db.user.findUnique({ where: { email } });
        if (!row) return;
        await recordAudit(db, {
          tenantId: row.tenantId,
          userId: row.id,
          userEmail: row.email,
          category: 'auth',
          action: 'signed_out',
          summary: 'Signed out',
        });
      } catch (e) {
        // eslint-disable-next-line no-console
        console.warn('[auth] signed_out audit failed:', e);
      }
    },
    async createUser({ user }: any) {
      // Fires only with the database adapter — we use JWT strategy so
      // this event won't fire. The User row is instead created inside
      // the `signIn` callback above; we audit `user_created` from
      // there when `isNewUser` would have been true (proxy: row was
      // just inserted). Keeping this hook present documents the shape.
      if (!user?.email) return;
      try {
        const row = await db.user.findUnique({ where: { email: user.email } });
        if (!row) return;
        await recordAudit(db, {
          tenantId: row.tenantId,
          userId: row.id,
          userEmail: row.email,
          category: 'auth',
          action: 'user_created',
          summary: `New user: ${row.email}`,
        });
      } catch (e) {
        // eslint-disable-next-line no-console
        console.warn('[auth] user_created audit failed:', e);
      }
    },
  },
});

export const handlers = _nextAuth.handlers;
export const signIn: (
  ...args: any[]
) => Promise<unknown> = _nextAuth.signIn;
export const signOut: (
  ...args: any[]
) => Promise<unknown> = _nextAuth.signOut;
export const auth: (
  ...args: any[]
) => Promise<{
  user?: {
    name?: string | null;
    email?: string | null;
    image?: string | null;
    userId?: number;
    tenantId?: number;
    role?: string;
  };
} | null> = _nextAuth.auth;
