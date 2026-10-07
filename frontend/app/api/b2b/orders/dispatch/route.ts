import { NextRequest } from 'next/server';
import { proxyToStrapi } from '@/lib/bff-proxy';

export async function POST(request: NextRequest) {
  return proxyToStrapi(request, '/api/b2b/orders/dispatch', { method: 'POST' });
}
