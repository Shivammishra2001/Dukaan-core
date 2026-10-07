import { NextRequest } from 'next/server';
import { proxyToStrapi } from '@/lib/bff-proxy';

// Live numbers: never statically cached or ISR'd, so a bill from /pos shows on the next fetch.
export const dynamic = 'force-dynamic';
export const revalidate = 0;

/** GET /api/dashboard/summary — owner dashboard aggregates for the session's store (Strapi /api/dashboard-summary). */
export async function GET(request: NextRequest) {
  return proxyToStrapi(request, '/api/dashboard-summary', { method: 'GET' });
}
