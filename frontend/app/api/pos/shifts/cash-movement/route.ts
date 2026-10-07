import { NextRequest, NextResponse } from 'next/server';
import { readSession } from '@/lib/session';

const STRAPI_URL = process.env.STRAPI_URL ?? 'http://localhost:1337';
const STRAPI_SERVICE_TOKEN = process.env.STRAPI_SERVICE_TOKEN ?? '';

/**
 * `POST /api/pos/shifts/cash-movement` — deliberately takes `shift_id` in
 * the body rather than the URL (the literal path Milestone 5 asked for),
 * and forwards to Strapi's `/api/shifts/{shift_id}/cash-movement`
 * (backend/src/api/shift/routes/shift-lifecycle.ts). Doesn't use
 * lib/bff-proxy.ts's proxyToStrapi() because the upstream path depends on a
 * field inside the body, which proxyToStrapi can't see before it re-reads
 * the request — store/tenant context still comes from the verified session,
 * same as every other proxy route.
 */
export async function POST(request: NextRequest) {
  const traceId = request.headers.get('x-trace-id') ?? crypto.randomUUID();

  const session = readSession(request);
  if (!session) {
    return NextResponse.json({ error: { code: 'ERR_UNAUTHENTICATED', message: 'Not signed in', trace_id: traceId } }, { status: 401 });
  }

  let body: { shift_id?: string } & Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: { code: 'ERR_VALIDATION', message: 'Request body must be JSON', trace_id: traceId } }, { status: 400 });
  }
  if (!body.shift_id) {
    return NextResponse.json({ error: { code: 'ERR_VALIDATION', message: 'shift_id is required', trace_id: traceId } }, { status: 400 });
  }

  const { shift_id, ...payload } = body;

  let upstream: Response;
  try {
    upstream = await fetch(`${STRAPI_URL}/api/shifts/${shift_id}/cash-movement`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Trace-Id': traceId,
        'X-Store-Id': session.storeId,
        'X-Tenant-Id': session.tenantId,
        'X-User-Id': session.userId,
        'X-Cashier-Id': session.userId,
        Authorization: `Bearer ${STRAPI_SERVICE_TOKEN}`,
      },
      body: JSON.stringify(payload),
      cache: 'no-store',
    });
  } catch {
    return NextResponse.json(
      { error: { code: 'ERR_UPSTREAM_UNREACHABLE', message: 'Could not reach the Strapi backend', trace_id: traceId } },
      { status: 502 }
    );
  }

  const upstreamBody = await upstream.text();
  return new NextResponse(upstreamBody, { status: upstream.status, headers: { 'Content-Type': 'application/json; charset=utf-8' } });
}
