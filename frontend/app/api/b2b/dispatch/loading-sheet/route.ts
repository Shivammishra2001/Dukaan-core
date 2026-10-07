import { NextRequest } from 'next/server';
import { proxyToStrapi } from '@/lib/bff-proxy';

export async function GET(request: NextRequest) {
  return proxyToStrapi(request, `/api/b2b/dispatch/loading-sheet${request.nextUrl.search}`, { method: 'GET' });
}
