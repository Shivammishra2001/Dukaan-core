import { NextRequest, NextResponse } from 'next/server';
import { SESSION_COOKIE } from '@/lib/auth-session';

/**
 * Coarse gate only: presence of the session cookie, not signature/expiry
 * verification — middleware runs on the Edge runtime, where the `jsonwebtoken`
 * package (Node crypto) that backend/src/api/auth/services/auth.ts uses isn't
 * available. Real verification happens server-side on every request that
 * matters: GET /api/auth/me forwards the cookie to Strapi, which verifies the
 * JWT properly. A page here should call that route on load and redirect to
 * /login itself if it 401s, rather than trusting this middleware alone.
 */
const PROTECTED_PREFIXES = ['/pos', '/b2b', '/dashboard', '/customers', '/inventory', '/reports'];

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const isProtected = PROTECTED_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`));
  if (!isProtected) return NextResponse.next();

  const hasSession = Boolean(request.cookies.get(SESSION_COOKIE)?.value);
  if (hasSession) return NextResponse.next();

  const loginUrl = new URL('/login', request.url);
  loginUrl.searchParams.set('next', pathname);
  return NextResponse.redirect(loginUrl);
}

export const config = {
  matcher: ['/pos/:path*', '/b2b/:path*', '/dashboard/:path*', '/customers/:path*', '/inventory/:path*', '/reports/:path*'],
};
