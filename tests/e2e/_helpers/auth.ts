import { encode } from '@auth/core/jwt';
import type { BrowserContext } from '@playwright/test';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Test-only auth helper. Mints an Auth.js v5–compatible session cookie and
 * drops it on the Playwright browser context, so specs can hit auth-gated
 * routes (`/dashboard/*`) without driving a real Google OAuth flow.
 *
 * Why this is safe:
 *   - Uses the same `AUTH_SECRET` the running app uses, so the cookie is a
 *     legitimate Auth.js JWT — no app code is changed, no test backdoor.
 *   - Only runs from Playwright. Production code is untouched.
 *
 * Cookie shape mirrors Auth.js v5 JWT-strategy defaults:
 *   - name:  `authjs.session-token` for HTTP / `__Secure-…` would be HTTPS
 *   - salt:  cookie name (Auth.js default)
 *   - token: standard JWT claims + our custom userId/tenantId/role so the
 *     `session()` callback hands the app a fully-populated session.
 */

const HTTP_COOKIE = 'authjs.session-token';
const SECURE_COOKIE = '__Secure-authjs.session-token';

interface TestUser {
  email: string;
  name?: string;
  userId?: number;
  tenantId?: number;
  role?: 'member' | 'admin';
}

export const DEFAULT_TEST_USER: Required<TestUser> = {
  email: 'adityauphade@makanalytics.org',
  name: 'Test User',
  userId: 1,
  tenantId: 1,
  role: 'member',
};

/**
 * Locate AUTH_SECRET. Prefer process.env so CI can inject it; fall back to
 * the dev `apps/web/.env.local` so local `pnpm test:e2e` Just Works.
 */
function loadAuthSecret(): string {
  const fromEnv = process.env.AUTH_SECRET ?? process.env.NEXTAUTH_SECRET;
  if (fromEnv) return stripQuotes(fromEnv);

  const candidates = [
    join(process.cwd(), 'apps/web/.env.local'),
    join(__dirname, '../../../apps/web/.env.local'),
  ];
  for (const p of candidates) {
    if (!existsSync(p)) continue;
    const env = readFileSync(p, 'utf8');
    const m = env.match(/^(?:AUTH_SECRET|NEXTAUTH_SECRET)=(.+)$/m);
    if (m) return stripQuotes(m[1].trim());
  }
  throw new Error(
    '[tests/auth] AUTH_SECRET not found. Set AUTH_SECRET in env or apps/web/.env.local.',
  );
}

function stripQuotes(s: string): string {
  return s.replace(/^"(.*)"$/, '$1').replace(/^'(.*)'$/, '$1');
}

function inferDomain(): { domain: string; secure: boolean } {
  const baseUrl = process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:3000';
  const u = new URL(baseUrl);
  return { domain: u.hostname, secure: u.protocol === 'https:' };
}

/**
 * Sign in by injecting an encrypted Auth.js session cookie into the
 * provided context. Call once per test (or in `beforeEach`) before any
 * navigation to a gated route.
 */
export async function signInAs(
  context: BrowserContext,
  user: TestUser = DEFAULT_TEST_USER,
): Promise<void> {
  const u = { ...DEFAULT_TEST_USER, ...user };
  const secret = loadAuthSecret();
  const { domain, secure } = inferDomain();
  const cookieName = secure ? SECURE_COOKIE : HTTP_COOKIE;

  const now = Math.floor(Date.now() / 1000);
  const token = await encode({
    secret,
    salt: cookieName,
    token: {
      name: u.name,
      email: u.email,
      sub: u.email,
      picture: null,
      userId: u.userId,
      tenantId: u.tenantId,
      role: u.role,
      iat: now,
      exp: now + 30 * 24 * 60 * 60,
      jti: `test-${now}`,
    },
  });

  await context.addCookies([
    {
      name: cookieName,
      value: token,
      domain,
      path: '/',
      httpOnly: true,
      secure,
      sameSite: 'Lax',
      expires: now + 30 * 24 * 60 * 60,
    },
  ]);
}
