import 'server-only';
import { PrismaClient } from '@prisma/client';
import { auditExtensionFactory } from './audit';

/**
 * Prisma client singleton, wrapped with the audit-log extension.
 *
 *   - `rawDb` is the unextended client. The audit extension uses it
 *     internally to write AuditLog rows without recursing through
 *     its own interception path. Never export this.
 *   - `db` is the extended client every app route uses. Mutations on
 *     auditable models (see lib/audit.ts) auto-log when an audit
 *     context is set via `withAuth()` / `withSystemAuditContext()`.
 *
 * The `globalThis.__prisma` cache prevents Next.js dev hot-reload from
 * creating a new client per reload (which exhausts connection pools).
 * In production each Vercel function instance gets its own.
 */
declare global {
  // eslint-disable-next-line no-var
  var __prisma: PrismaClient | undefined;
}

const rawDb: PrismaClient = globalThis.__prisma ?? new PrismaClient();

if (process.env.NODE_ENV !== 'production') {
  globalThis.__prisma = rawDb;
}

export const db = rawDb.$extends(auditExtensionFactory(rawDb));

/**
 * Internal access to the unextended client. Only `lib/audit.ts` and a
 * handful of places that genuinely need to bypass auto-audit (e.g.
 * standalone scripts) should use this. App routes use `db`.
 */
export const dbRaw: PrismaClient = rawDb;
