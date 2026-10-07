import { NextRequest, NextResponse } from 'next/server';
import { readSession } from '@/lib/session';

const STRAPI_URL = process.env.STRAPI_URL ?? 'http://localhost:1337';
const STRAPI_SERVICE_TOKEN = process.env.STRAPI_SERVICE_TOKEN ?? '';

export interface RecordSupplierPaymentRequest {
  amount_paise: number;
  method: 'CASH' | 'UPI' | 'BANK_TRANSFER' | 'CHEQUE';
  reference?: string;
  note?: string;
}

/**
 * POST /api/b2b/suppliers/{id}/payment — "Settle Payment" on the Supplier
 * ledger drill-down. Mirrors app/api/customers/[id]/payment/route.ts exactly,
 * but posts a PAYMENT_MADE/DEBIT entry (we owe the supplier less) instead of
 * a customer's PAYMENT_RECEIVED/CREDIT — see supplier.controller.ts's
 * postLedgerEntry, the same generic ledger-entries endpoint used by
 * purchase-inward.ts for the PURCHASE_BILL credit.
 */
export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  const traceId = request.headers.get('x-trace-id') ?? crypto.randomUUID();

  const session = readSession(request);
  if (!session) {
    return NextResponse.json({ error: { code: 'ERR_UNAUTHENTICATED', message: 'Not signed in', trace_id: traceId } }, { status: 401 });
  }

  let body: RecordSupplierPaymentRequest;
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

  const note = [`Paid via ${body.method}`, body.reference, body.note].filter(Boolean).join(' — ');

  let upstream: Response;
  try {
    upstream = await fetch(`${STRAPI_URL}/api/suppliers/${params.id}/ledger-entries`, {
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
        entry_type: 'PAYMENT_MADE',
        direction: 'DEBIT',
        amount_paise: body.amount_paise,
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
