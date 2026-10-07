import { NextRequest } from 'next/server';
import { proxyToStrapi } from '@/lib/bff-proxy';

/** GET /api/customers/{id}/ledger — proxies to Strapi's customer.ledgerEntries custom action (src/api/customer/controllers/customer.ts). */
export async function GET(request: NextRequest, { params }: { params: { id: string } }) {
  return proxyToStrapi(request, `/api/customers/${params.id}/ledger-entries${request.nextUrl.search}`, { method: 'GET' });
}
