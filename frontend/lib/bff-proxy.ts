import { NextRequest, NextResponse } from 'next/server';
import { readSession } from './session';

/**
 * SYSTEM_ARCHITECTURE.md §1.1 — shared BFF->Strapi proxy body, factored out
 * of app/api/pos/checkout/route.ts once the shift routes needed the same
 * shape. Store/tenant context is derived from the verified `dukaan_session`
 * cookie (see lib/session.ts) — never trusted from the client and never
 * pinned to an env-configured default store.
 */

const STRAPI_URL = process.env.STRAPI_URL ?? 'http://localhost:1337';
const STRAPI_SERVICE_TOKEN = process.env.STRAPI_SERVICE_TOKEN ?? '';

function errorBody(code: string, message: string, traceId: string) {
  return { error: { code, message, trace_id: traceId } };
}

export async function proxyToStrapi(
  request: NextRequest,
  strapiPath: string,
  opts: { method: 'GET' | 'POST'; requireIdempotencyKey?: boolean } = { method: 'POST' }
): Promise<NextResponse> {
  const traceId = request.headers.get('x-trace-id') ?? crypto.randomUUID();
  const idempotencyKey = request.headers.get('idempotency-key');
  const deviceId = request.headers.get('x-device-id');

  if (opts.requireIdempotencyKey && !idempotencyKey) {
    return NextResponse.json(errorBody('ERR_VALIDATION', 'Idempotency-Key header is required', traceId), { status: 400 });
  }

  const session = readSession(request);
  if (!session) {
    return NextResponse.json(errorBody('ERR_UNAUTHENTICATED', 'Not signed in', traceId), { status: 401 });
  }

  let body: unknown;
  if (opts.method === 'POST') {
    try {
      body = await request.json();
    } catch {
      return NextResponse.json(errorBody('ERR_VALIDATION', 'Request body must be JSON', traceId), { status: 400 });
    }
  }

  let upstream: Response;
  try {
    upstream = await fetch(`${STRAPI_URL}${strapiPath}`, {
      method: opts.method,
      headers: {
        'Content-Type': 'application/json',
        'X-Trace-Id': traceId,
        'X-Store-Id': session.storeId,
        'X-Tenant-Id': session.tenantId,
        'X-User-Id': session.userId,
        // The checkout/shift controllers attribute orders and shifts via X-Cashier-Id;
        // without it they fall back to a placeholder "System Cashier".
        'X-Cashier-Id': session.userId,
        'X-User-Role': session.role,
        ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}),
        ...(deviceId ? { 'X-Device-Id': deviceId } : {}),
        Authorization: `Bearer ${STRAPI_SERVICE_TOKEN}`,
      },
      body: opts.method === 'POST' ? JSON.stringify(body) : undefined,
      cache: 'no-store',
    });
  } catch {
    return NextResponse.json(errorBody('ERR_UPSTREAM_UNREACHABLE', 'Could not reach the Strapi backend', traceId), {
      status: 502,
    });
  }

  const upstreamBody = await upstream.text();
  return new NextResponse(upstreamBody, {
    status: upstream.status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      ...(upstream.headers.get('x-server-time') ? { 'X-Server-Time': upstream.headers.get('x-server-time')! } : {}),
      ...(upstream.headers.get('idempotent-replay') ? { 'Idempotent-Replay': upstream.headers.get('idempotent-replay')! } : {}),
    },
  });
}
