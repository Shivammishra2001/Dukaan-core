import { NextRequest, NextResponse } from 'next/server';
import { readSession } from '@/lib/session';
import type { RecordPaymentRequest } from '@/types/customer';

const STRAPI_URL = process.env.STRAPI_URL ?? 'http://localhost:1337';
const STRAPI_SERVICE_TOKEN = process.env.STRAPI_SERVICE_TOKEN ?? '';

/**
 * POST /api/customers/{id}/payment — "Record Payment" on the Customer Khata
 * drill-down. There is no dedicated settle/allocation service in this
 * backend yet (API_CONTRACTS.md §5.3 is aspirational — only the generic
 * ledger-entries endpoint from customer.controller.ts is implemented), so
 * this posts a PAYMENT_RECEIVED/CREDIT entry directly, which is exactly
 * what ledger.service.ts's postEntry does to reduce the cached balance.
 */
export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  const traceId = request.headers.get('x-trace-id') ?? crypto.randomUUID();

  const session = readSession(request);
  if (!session) {
    return NextResponse.json({ error: { code: 'ERR_UNAUTHENTICATED', message: 'Not signed in', trace_id: traceId } }, { status: 401 });
  }

  let body: RecordPaymentRequest;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: { code: 'ERR_VALIDATION', message: 'Request body must be JSON', trace_id: traceId } }, { status: 400 });
  }
  if (!body.amount_paise || body.amount_paise <= 0) {
    return NextResponse.json({ error: { code: 'ERR_VALIDATION', message: 'amount_paise must be > 0', trace_id: traceId } }, { status: 400 });
  }
  if (!body.method) {
    return NextResponse.json({ error: { code: 'ERR_VALIDATION', message: 'method is required', trace_id: traceId } }, { status: 400 });
  }

  const note = [`Paid via ${body.method}`, body.note].filter(Boolean).join(' — ');

  let upstream: Response;
  try {
    upstream = await fetch(`${STRAPI_URL}/api/customers/${params.id}/ledger-entries`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Trace-Id': traceId,
        'X-Store-Id': session.storeId,
        'X-Tenant-Id': session.tenantId,
        'X-User-Id': session.userId,
        Authorization: `Bearer ${STRAPI_SERVICE_TOKEN}`,
      },
      body: JSON.stringify({
        entry_type: 'PAYMENT_RECEIVED',
        direction: 'CREDIT',
        amount_paise: body.amount_paise,
        entry_date: body.entry_date ?? new Date().toISOString().slice(0, 10),
        note,
      }),
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
