/**
 * ADR-05 (BFF in Next.js): the session JWT is set as an HTTP-only cookie on
 * the frontend's own origin — a Strapi response on port 1337 can't set a
 * cookie readable/usable by port 3000, so the app/api/auth/*.ts Route
 * Handlers own the cookie, not Strapi. Client code never sees the raw token.
 */
export const SESSION_COOKIE = 'dukaan_session';

const STRAPI_URL = process.env.STRAPI_URL ?? 'http://localhost:1337';

export function strapiUrl(path: string): string {
  return `${STRAPI_URL}${path}`;
}

export const SESSION_COOKIE_OPTIONS = {
  httpOnly: true,
  sameSite: 'lax' as const,
  secure: process.env.NODE_ENV === 'production',
  path: '/',
  maxAge: 60 * 60 * 24 * 7, // 7 days, matches backend's JWT_EXPIRES_IN
};
