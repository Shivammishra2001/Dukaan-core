import { NextRequest } from 'next/server';
import { proxyToStrapi } from '@/lib/bff-proxy';

export async function POST(request: NextRequest) {
  return proxyToStrapi(request, '/api/purchases/inward', { method: 'POST', requireIdempotencyKey: true });
}
