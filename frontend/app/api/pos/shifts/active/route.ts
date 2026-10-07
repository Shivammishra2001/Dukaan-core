import { NextRequest } from 'next/server';
import { proxyToStrapi } from '@/lib/bff-proxy';

/**
 * GET /api/pos/shifts/active — the signed-in cashier's OPEN shift in the
 * session store (or `data: null`), so the POS can resume it after a reload
 * instead of offering "Open Shift". Proxies to Strapi's `/api/active-shift`
 * (backend/src/api/shift/routes/shift-lifecycle.ts); store and cashier come
 * from the verified session via proxyToStrapi's headers.
 */
export async function GET(request: NextRequest) {
  return proxyToStrapi(request, '/api/active-shift', { method: 'GET' });
}
