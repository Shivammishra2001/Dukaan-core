import { NextRequest, NextResponse } from 'next/server';
import { readSession } from '@/lib/session';
import type { UpdateProductRatesRequest } from '@/types/inventory';

const STRAPI_URL = process.env.STRAPI_URL ?? 'http://localhost:1337';
const STRAPI_SERVICE_TOKEN = process.env.STRAPI_SERVICE_TOKEN ?? '';

function errorBody(code: string, message: string, traceId: string) {
  return { error: { code, message, trace_id: traceId } };
}

/** PATCH /api/inventory/products/{id} — the quick inline rate editor. Forwards to Strapi's core `PUT /api/products/{id}`; only mrp_paise/sell_rate_paise/wholesale_tier{1,2}_rate_paise are accepted, everything else about the product is left untouched. */
export async function PATCH(request: NextRequest, { params }: { params: { id: string } }) {
  const traceId = request.headers.get('x-trace-id') ?? crypto.randomUUID();
  const session = readSession(request);
  if (!session) {
    return NextResponse.json(errorBody('ERR_UNAUTHENTICATED', 'Not signed in', traceId), { status: 401 });
  }

  let body: UpdateProductRatesRequest;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(errorBody('ERR_VALIDATION', 'Request body must be JSON', traceId), { status: 400 });
  }
  const data: UpdateProductRatesRequest = {};
  if (body.mrp_paise != null) data.mrp_paise = body.mrp_paise;
  if (body.sell_rate_paise != null) data.sell_rate_paise = body.sell_rate_paise;
  if ('wholesale_tier1_rate_paise' in body) data.wholesale_tier1_rate_paise = body.wholesale_tier1_rate_paise;
  if ('wholesale_tier2_rate_paise' in body) data.wholesale_tier2_rate_paise = body.wholesale_tier2_rate_paise;
  if (Object.keys(data).length === 0) {
    return NextResponse.json(errorBody('ERR_VALIDATION', 'mrp_paise, sell_rate_paise and/or wholesale tier rates are required', traceId), { status: 400 });
  }

  let upstream: Response;
  try {
    upstream = await fetch(`${STRAPI_URL}/api/products/${params.id}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'X-Trace-Id': traceId,
        'X-Store-Id': session.storeId,
        'X-Tenant-Id': session.tenantId,
        Authorization: `Bearer ${STRAPI_SERVICE_TOKEN}`,
      },
      body: JSON.stringify({ data }),
      cache: 'no-store',
    });
  } catch {
    return NextResponse.json(errorBody('ERR_UPSTREAM_UNREACHABLE', 'Could not reach the Strapi backend', traceId), { status: 502 });
  }

  const upstreamBody = await upstream.text();
  return new NextResponse(upstreamBody, { status: upstream.status, headers: { 'Content-Type': 'application/json; charset=utf-8' } });
}
