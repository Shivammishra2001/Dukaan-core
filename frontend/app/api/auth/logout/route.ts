import { NextResponse } from 'next/server';
import { SESSION_COOKIE } from '@/lib/auth-session';

/** POST /api/auth/logout — clears the session cookie. Nothing to revoke server-side; the JWT just expires on its own (7d). */
export async function POST() {
  const res = NextResponse.json({ data: { ok: true } });
  res.cookies.delete(SESSION_COOKIE);
  return res;
}
