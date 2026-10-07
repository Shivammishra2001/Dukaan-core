import { NextRequest, NextResponse } from 'next/server';
import { readSession } from '@/lib/session';

const STRAPI_URL = process.env.STRAPI_URL ?? 'http://localhost:1337';
const STRAPI_SERVICE_TOKEN = process.env.STRAPI_SERVICE_TOKEN ?? '';

/** GET /api/reports/shifts — Galla & Shifts history, scoped to the session's store. Strapi's shift router only exposes find/findOne (backend/src/api/shift/routes/shift.ts) — writes stay on the shift-lifecycle routes. */
export async function GET(request: NextRequest) {
  const traceId = request.headers.get('x-trace-id') ?? crypto.randomUUID();
  const session = readSession(request);
  if (!session) {
    return NextResponse.json({ error: { code: 'ERR_UNAUTHENTICATED', message: 'Not signed in', trace_id: traceId } }, { status: 401 });
  }

  const qs = new URLSearchParams({
    'filters[store][documentId][$eq]': session.storeId,
    'sort[0]': 'opened_at:desc',
    'pagination[pageSize]': '50',
    'populate[counter]': 'true',
    'populate[cashier]': 'true',
  });

  let upstream: Response;
  try {
    upstream = await fetch(`${STRAPI_URL}/api/shifts?${qs.toString()}`, {
      headers: { 'X-Trace-Id': traceId, 'X-Store-Id': session.storeId, 'X-Tenant-Id': session.tenantId, Authorization: `Bearer ${STRAPI_SERVICE_TOKEN}` },
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
