import { NextResponse } from 'next/server';
import { encode } from '@auth/core/jwt';

export const runtime = 'nodejs';

/**
 * DEV-ONLY login endpoint. Mints an Auth.js JWT session cookie so the
 * dashboard pages are accessible without going through Google OAuth.
 *
 * Refuses unless NODE_ENV !== 'production'. Reuses the same cookie shape
 * the Playwright auth helper uses (tests/e2e/_helpers/auth.ts).
 *
 * Usage:
 *   GET /api/dev/login           → sets cookie, redirects to /dashboard
 *   GET /api/dev/login?to=/foo   → sets cookie, redirects to /foo
 */

const TEST_USER = {
  email: 'adityauphade@makanalytics.org',
  name: 'Aditya Uphade',
  userId: 1,
  tenantId: 1,
  role: 'owner',
};

export async function GET(req: Request) {
  if (process.env.NODE_ENV === 'production') {
    return NextResponse.json(
      { error: 'dev-login disabled in production' },
      { status: 404 },
    );
  }

  const secret = process.env.AUTH_SECRET ?? process.env.NEXTAUTH_SECRET;
  if (!secret) {
    return NextResponse.json(
      { error: 'AUTH_SECRET not set — cannot mint dev session' },
      { status: 500 },
    );
  }

  const cookieName = 'authjs.session-token';
  const maxAge = 60 * 60 * 24 * 30; // 30 days
  const token = await encode({
    secret,
    salt: cookieName,
    token: {
      name: TEST_USER.name,
      email: TEST_USER.email,
      userId: TEST_USER.userId,
      tenantId: TEST_USER.tenantId,
      role: TEST_USER.role,
      sub: String(TEST_USER.userId),
    },
    maxAge,
  });

  const url = new URL(req.url);
  const to = url.searchParams.get('to') ?? '/dashboard/scheduler';
  const target = new URL(to, url.origin);

  const res = NextResponse.redirect(target.toString());
  res.cookies.set(cookieName, token, {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    maxAge,
    secure: false,
  });
  return res;
}
