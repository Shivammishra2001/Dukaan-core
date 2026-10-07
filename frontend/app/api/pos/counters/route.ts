import { NextRequest, NextResponse } from 'next/server';
import { readSession } from '@/lib/session';

const STRAPI_URL = process.env.STRAPI_URL ?? 'http://localhost:1337';
const STRAPI_SERVICE_TOKEN = process.env.STRAPI_SERVICE_TOKEN ?? '';

/**
 * GET /api/pos/counters — the session's store's active counters, sorted so
 * the lowest `code` (the store's primary/first-seeded counter) comes first.
 * Fixes ERR_STORE_MISMATCH on /api/shifts/open: that route's
 * resolveCounterStrict() (backend/src/api/shift/services/shift-lifecycle.ts)
 * requires counter_id to belong to the session's store, but the POS page
 * used to hardcode lib/mock-data.ts's STORE_CONFIG.counter_id — a fake id
 * that never matches any real counter once the BFF stopped trusting a
 * static DEFAULT_STORE_DOCUMENT_ID and started deriving X-Store-Id from the
 * session. This route lets the client fetch a real counter for its own
 * store instead of guessing one.
 */
export async function GET(request: NextRequest) {
  const traceId = request.headers.get('x-trace-id') ?? crypto.randomUUID();
  const session = readSession(request);
  if (!session) {
    return NextResponse.json({ error: { code: 'ERR_UNAUTHENTICATED', message: 'Not signed in', trace_id: traceId } }, { status: 401 });
  }

  const qs = new URLSearchParams({
    'filters[store][documentId][$eq]': session.storeId,
    'filters[is_active][$eq]': 'true',
    'sort[0]': 'code:asc',
    'pagination[pageSize]': '50',
  });

  let upstream: Response;
  try {
    upstream = await fetch(`${STRAPI_URL}/api/counters?${qs.toString()}`, {
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
