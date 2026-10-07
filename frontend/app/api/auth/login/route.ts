import { NextRequest, NextResponse } from 'next/server';
import { SESSION_COOKIE, SESSION_COOKIE_OPTIONS, strapiUrl } from '@/lib/auth-session';

/** POST /api/auth/login — same token->cookie split as register-company/route.ts. */
export async function POST(request: NextRequest) {
  const traceId = request.headers.get('x-trace-id') ?? crypto.randomUUID();

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: { code: 'ERR_VALIDATION', message: 'Request body must be JSON', trace_id: traceId } }, { status: 400 });
  }

  let upstream: Response;
  try {
    upstream = await fetch(strapiUrl('/api/auth/login'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      cache: 'no-store',
    });
  } catch {
    return NextResponse.json(
      { error: { code: 'ERR_UPSTREAM_UNREACHABLE', message: 'Could not reach the Strapi backend', trace_id: traceId } },
      { status: 502 }
    );
  }

  const payload = await upstream.json().catch(() => null);
  if (!upstream.ok || !payload?.data?.token) {
    return NextResponse.json(payload ?? { error: { code: 'ERR_UPSTREAM', message: 'Login failed', trace_id: traceId } }, {
      status: upstream.status || 502,
    });
  }

  const { token, ...profile } = payload.data;
  const res = NextResponse.json({ data: profile }, { status: 200 });
  res.cookies.set(SESSION_COOKIE, token, SESSION_COOKIE_OPTIONS);
  return res;
}
