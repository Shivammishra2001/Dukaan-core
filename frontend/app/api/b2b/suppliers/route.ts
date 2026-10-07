import { NextRequest, NextResponse } from 'next/server';
import { readSession } from '@/lib/session';

const STRAPI_URL = process.env.STRAPI_URL ?? 'http://localhost:1337';
const STRAPI_SERVICE_TOKEN = process.env.STRAPI_SERVICE_TOKEN ?? '';

function errorBody(code: string, message: string, traceId: string) {
  return { error: { code, message, trace_id: traceId } };
}

/**
 * GET /api/b2b/suppliers — real supplier directory, scoped to the session's
 * store. Replaces lib/b2b-mock-data.ts's MOCK_SUPPLIERS, whose fake ids
 * (e.g. "supplier-adani-wilmar") don't correspond to any real supplier row —
 * submitting a purchase inward against one always 403s with
 * ERR_STORE_MISMATCH.
 */
export async function GET(request: NextRequest) {
  const traceId = request.headers.get('x-trace-id') ?? crypto.randomUUID();
  const session = readSession(request);
  if (!session) {
    return NextResponse.json(errorBody('ERR_UNAUTHENTICATED', 'Not signed in', traceId), { status: 401 });
  }

  const qs = new URLSearchParams({
    'filters[store][documentId][$eq]': session.storeId,
    'filters[is_active][$eq]': 'true',
    'sort[0]': 'name:asc',
    'pagination[pageSize]': '200',
  });

  let upstream: Response;
  try {
    upstream = await fetch(`${STRAPI_URL}/api/suppliers?${qs.toString()}`, {
      headers: { 'X-Trace-Id': traceId, 'X-Store-Id': session.storeId, 'X-Tenant-Id': session.tenantId, Authorization: `Bearer ${STRAPI_SERVICE_TOKEN}` },
      cache: 'no-store',
    });
  } catch {
    return NextResponse.json(errorBody('ERR_UPSTREAM_UNREACHABLE', 'Could not reach the Strapi backend', traceId), { status: 502 });
  }

  const upstreamBody = await upstream.text();
  return new NextResponse(upstreamBody, { status: upstream.status, headers: { 'Content-Type': 'application/json; charset=utf-8' } });
}

/** POST /api/b2b/suppliers — "+ New" quick-add from the Purchase Inward form. Store is injected server-side from the session, never trusted from the client body. */
export async function POST(request: NextRequest) {
  const traceId = request.headers.get('x-trace-id') ?? crypto.randomUUID();
  const session = readSession(request);
  if (!session) {
    return NextResponse.json(errorBody('ERR_UNAUTHENTICATED', 'Not signed in', traceId), { status: 401 });
  }

  let body: { name?: string; gstin?: string; phone?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(errorBody('ERR_VALIDATION', 'Request body must be JSON', traceId), { status: 400 });
  }
  if (!body.name?.trim()) {
    return NextResponse.json(errorBody('ERR_VALIDATION', 'name is required', traceId), { status: 400 });
  }

  let upstream: Response;
  try {
    upstream = await fetch(`${STRAPI_URL}/api/suppliers`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Trace-Id': traceId,
        'X-Store-Id': session.storeId,
        'X-Tenant-Id': session.tenantId,
        Authorization: `Bearer ${STRAPI_SERVICE_TOKEN}`,
      },
      body: JSON.stringify({ data: { name: body.name.trim(), gstin: body.gstin || undefined, phone: body.phone || undefined, store: session.storeId } }),
      cache: 'no-store',
    });
  } catch {
    return NextResponse.json(errorBody('ERR_UPSTREAM_UNREACHABLE', 'Could not reach the Strapi backend', traceId), { status: 502 });
  }

  const upstreamBody = await upstream.text();
  return new NextResponse(upstreamBody, { status: upstream.status, headers: { 'Content-Type': 'application/json; charset=utf-8' } });
}
