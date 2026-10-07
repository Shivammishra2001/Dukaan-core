import { NextRequest } from 'next/server';
import { proxyToStrapi } from '@/lib/bff-proxy';

/** GET /api/b2b/orders?status=BOOKED — lists via the read-only Content API route (b2b-order/routes/b2b-order.ts only exposes find/findOne). */
export async function GET(request: NextRequest) {
  const status = request.nextUrl.searchParams.get('status');
  const qs = new URLSearchParams({ 'populate[customer]': 'true', 'sort[0]': 'booked_at:desc', 'pagination[pageSize]': '100' });
  if (status) qs.set('filters[status][$eq]', status);
  return proxyToStrapi(request, `/api/b2b-orders?${qs.toString()}`, { method: 'GET' });
}
