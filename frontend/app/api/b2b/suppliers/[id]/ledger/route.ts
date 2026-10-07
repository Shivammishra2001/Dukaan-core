import { NextRequest } from 'next/server';
import { proxyToStrapi } from '@/lib/bff-proxy';

export async function GET(request: NextRequest, { params }: { params: { id: string } }) {
  return proxyToStrapi(request, `/api/suppliers/${params.id}/ledger-entries${request.nextUrl.search}`, { method: 'GET' });
}
