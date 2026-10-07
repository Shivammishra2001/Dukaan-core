import { NextRequest, NextResponse } from 'next/server';
import { proxyToStrapi } from '@/lib/bff-proxy';
import { readSession } from '@/lib/session';

/** GET /api/customers?q= — customer directory, scoped to the session's store (never trusted from the client). Strapi core find route (customer/routes/customer.ts only adds custom ledger routes alongside the default router). */
export async function GET(request: NextRequest) {
  const traceId = request.headers.get('x-trace-id') ?? crypto.randomUUID();
  const session = readSession(request);
  if (!session) {
    return NextResponse.json({ error: { code: 'ERR_UNAUTHENTICATED', message: 'Not signed in', trace_id: traceId } }, { status: 401 });
  }

  const q = request.nextUrl.searchParams.get('q');
  const qs = new URLSearchParams({
    'filters[store][documentId][$eq]': session.storeId,
    'filters[is_active][$eq]': 'true',
    'sort[0]': 'name:asc',
    'pagination[pageSize]': '200',
  });
  if (q) qs.set('filters[name][$containsi]', q);

  return proxyToStrapi(request, `/api/customers?${qs.toString()}`, { method: 'GET' });
}
