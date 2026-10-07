import { NextRequest, NextResponse } from 'next/server';
import { readSession } from '@/lib/session';
import type { CreateProductRequest } from '@/types/inventory';

const STRAPI_URL = process.env.STRAPI_URL ?? 'http://localhost:1337';
const STRAPI_SERVICE_TOKEN = process.env.STRAPI_SERVICE_TOKEN ?? '';

function errorBody(code: string, message: string, traceId: string) {
  return { error: { code, message, trace_id: traceId } };
}

/**
 * GET /api/inventory/products?q= — Saman & Rates list, scoped to the
 * session's store, with each product's active batches populated so the
 * page can sum current stock (products carry no stock field of their own).
 * Also populates unit_conversions — the Purchase Inward form (b2b/purchases)
 * reuses this same route to build its product picker, and needs every
 * product's valid entered_unit set + factor_to_base for the stock preview.
 */
export async function GET(request: NextRequest) {
  const traceId = request.headers.get('x-trace-id') ?? crypto.randomUUID();
  const session = readSession(request);
  if (!session) {
    return NextResponse.json(errorBody('ERR_UNAUTHENTICATED', 'Not signed in', traceId), { status: 401 });
  }

  const q = request.nextUrl.searchParams.get('q');
  const qs = new URLSearchParams({
    'filters[store][documentId][$eq]': session.storeId,
    'filters[is_active][$eq]': 'true',
    'sort[0]': 'name:asc',
    'pagination[pageSize]': '500',
    'populate[category]': 'true',
    // A nested populate+filters query string (populate[batches][filters][status][$eq]=ACTIVE)
    // silently fails to populate `batches` at all — Strapi returns the field
    // omitted entirely rather than an error, so this was never caught. Populate
    // unconditionally instead; lib/inventory-client.ts's toProductRow() already
    // filters to ACTIVE batches client-side before summing stock.
    'populate[batches]': 'true',
    'populate[unit_conversions]': 'true',
  });
  if (q) qs.set('filters[name][$containsi]', q);

  let upstream: Response;
  try {
    upstream = await fetch(`${STRAPI_URL}/api/products?${qs.toString()}`, {
      headers: { 'X-Trace-Id': traceId, 'X-Store-Id': session.storeId, 'X-Tenant-Id': session.tenantId, Authorization: `Bearer ${STRAPI_SERVICE_TOKEN}` },
      cache: 'no-store',
    });
  } catch {
    return NextResponse.json(errorBody('ERR_UPSTREAM_UNREACHABLE', 'Could not reach the Strapi backend', traceId), { status: 502 });
  }

  const upstreamBody = await upstream.text();
  return new NextResponse(upstreamBody, { status: upstream.status, headers: { 'Content-Type': 'application/json; charset=utf-8' } });
}

/** POST /api/inventory/products — "Add Product/Service" modal. Store is injected server-side from the session, never trusted from the client body. */
export async function POST(request: NextRequest) {
  const traceId = request.headers.get('x-trace-id') ?? crypto.randomUUID();
  const session = readSession(request);
  if (!session) {
    return NextResponse.json(errorBody('ERR_UNAUTHENTICATED', 'Not signed in', traceId), { status: 401 });
  }

  let body: CreateProductRequest;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(errorBody('ERR_VALIDATION', 'Request body must be JSON', traceId), { status: 400 });
  }
  if (!body.sku || !body.name || !body.base_unit || !body.default_sale_unit || !body.default_purchase_unit || !body.pricing_unit || body.sell_rate_paise == null) {
    return NextResponse.json(
      errorBody('ERR_VALIDATION', 'sku, name, base_unit, default_sale_unit, default_purchase_unit, pricing_unit and sell_rate_paise are required', traceId),
      { status: 400 }
    );
  }

  const { purchase_unit_factor, ...productFields } = body;

  let upstream: Response;
  try {
    upstream = await fetch(`${STRAPI_URL}/api/products`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Trace-Id': traceId,
        'X-Store-Id': session.storeId,
        'X-Tenant-Id': session.tenantId,
        Authorization: `Bearer ${STRAPI_SERVICE_TOKEN}`,
      },
      body: JSON.stringify({ data: { ...productFields, store: session.storeId } }),
      cache: 'no-store',
    });
  } catch {
    return NextResponse.json(errorBody('ERR_UPSTREAM_UNREACHABLE', 'Could not reach the Strapi backend', traceId), { status: 502 });
  }

  const upstreamBody = await upstream.text();
  if (!upstream.ok) {
    return new NextResponse(upstreamBody, { status: upstream.status, headers: { 'Content-Type': 'application/json; charset=utf-8' } });
  }

  // backend/src/api/product/content-types/product/lifecycles.ts's afterCreate
  // hook already seeds the base_unit anchor row (factor 1) on every product
  // create per Rule UC-2 — this route used to *also* create it explicitly
  // (predating that hook), which left every product with two identical
  // base_unit unit_conversions rows (visible as a duplicate-React-key warning
  // on the unit <select> anywhere a product's conversions are rendered, e.g.
  // the POS cart line). Only the optional bulk/purchase-unit row (which the
  // hook does NOT create) still needs to be added here.
  let productDocumentId: string | undefined;
  try {
    productDocumentId = JSON.parse(upstreamBody)?.data?.documentId;
  } catch {
    /* fall through — return the product as created even if we can't parse it */
  }

  if (!productDocumentId) {
    return new NextResponse(upstreamBody, { status: upstream.status, headers: { 'Content-Type': 'application/json; charset=utf-8' } });
  }

  const conversions: Array<{ unit_code: string; factor_to_base: number; is_sale_unit: boolean; is_purchase_unit: boolean; sort_order: number }> = [];
  if (productFields.default_purchase_unit !== productFields.base_unit && purchase_unit_factor && purchase_unit_factor > 0) {
    conversions.push({ unit_code: productFields.default_purchase_unit, factor_to_base: purchase_unit_factor, is_sale_unit: false, is_purchase_unit: true, sort_order: 1 });
  }
  for (const data of conversions) {
    try {
      await fetch(`${STRAPI_URL}/api/unit-conversions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Trace-Id': traceId, Authorization: `Bearer ${STRAPI_SERVICE_TOKEN}` },
        body: JSON.stringify({ data: { ...data, store: session.storeId, product: productDocumentId } }),
        cache: 'no-store',
      });
    } catch {
      /* best-effort — the product still exists even if this fails; not worth failing the whole create over */
    }
  }

  // Strapi's create response doesn't populate relations, so the caller would
  // otherwise get back a product with an empty unit_conversions/batches —
  // immediately unusable in whatever picker just created it. Patch the
  // response with what was just created (plus the base_unit anchor the
  // lifecycle hook created server-side, synthesized here rather than
  // re-fetched, since we already know its exact shape) instead of a second
  // round-trip.
  let patchedBody = upstreamBody;
  try {
    const parsed = JSON.parse(upstreamBody);
    if (parsed?.data) {
      const baseUnitAnchor = { unit_code: productFields.base_unit, factor_to_base: 1, is_sale_unit: true, is_purchase_unit: true, sort_order: 0 };
      parsed.data.unit_conversions = [baseUnitAnchor, ...conversions].map((c) => ({ ...c, price_override_paise: null }));
      parsed.data.batches = [];
      patchedBody = JSON.stringify(parsed);
    }
  } catch {
    /* fall through — return the unpatched body */
  }

  return new NextResponse(patchedBody, { status: upstream.status, headers: { 'Content-Type': 'application/json; charset=utf-8' } });
}
