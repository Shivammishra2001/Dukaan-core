import { NextRequest } from 'next/server';
import { proxyToStrapi } from '@/lib/bff-proxy';

/**
 * SYSTEM_ARCHITECTURE.md §1.1 — the browser never talks to Strapi directly.
 * This is the BFF hop: it carries the service token and store context that
 * the client must never see (§7 Security Architecture: "Secrets never in
 * the client bundle"). API_CONTRACTS.md §2 names this exact path
 * (`POST /api/pos/checkout` at the BFF, proxied to Strapi's `/api/checkout`).
 *
 * Store/tenant/cashier context comes from the verified `dukaan_session`
 * cookie (see lib/session.ts and lib/bff-proxy.ts) — the client cannot spoof
 * a store by tampering with the request body.
 */
export async function POST(request: NextRequest) {
  return proxyToStrapi(request, '/api/checkout', { method: 'POST', requireIdempotencyKey: true });
}
