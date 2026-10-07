import { NextRequest, NextResponse } from 'next/server';
import { SESSION_COOKIE, strapiUrl } from '@/lib/auth-session';

/** GET /api/auth/me — reads the HTTP-only cookie server-side and forwards it as the Bearer token; the client never handles the raw JWT. */
export async function GET(request: NextRequest) {
  const traceId = request.headers.get('x-trace-id') ?? crypto.randomUUID();
  const token = request.cookies.get(SESSION_COOKIE)?.value;
  if (!token) {
    return NextResponse.json({ error: { code: 'ERR_UNAUTHENTICATED', message: 'Not signed in', trace_id: traceId } }, { status: 401 });
  }

  let upstream: Response;
  try {
    upstream = await fetch(strapiUrl('/api/auth/me'), {
      headers: { Authorization: `Bearer ${token}` },
      cache: 'no-store',
    });
  } catch {
    return NextResponse.json(
      { error: { code: 'ERR_UPSTREAM_UNREACHABLE', message: 'Could not reach the Strapi backend', trace_id: traceId } },
      { status: 502 }
    );
  }

  const payload = await upstream.text();
  return new NextResponse(payload, { status: upstream.status, headers: { 'Content-Type': 'application/json; charset=utf-8' } });
}
