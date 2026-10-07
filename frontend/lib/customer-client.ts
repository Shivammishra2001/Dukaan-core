import { getDeviceId } from '@/lib/sync/device';
import type { ApiErrorBody } from '@/types/checkout';
import type { CustomerLedgerEntry, CustomerLite, RecordPaymentRequest } from '@/types/customer';

/** Back-office pages (SYSTEM_ARCHITECTURE.md §2.1) — plain online fetch client, no Dexie/outbox, same split as lib/b2b-client.ts. */

export type CustomerResult<T> = { ok: true; data: T } | { ok: false; error: string };

async function callBff<T>(path: string, opts: { method: 'GET' | 'POST'; body?: unknown } = { method: 'GET' }): Promise<CustomerResult<T>> {
  let res: Response;
  try {
    res = await fetch(path, {
      method: opts.method,
      headers: { 'Content-Type': 'application/json', 'X-Device-Id': getDeviceId() },
      body: opts.body ? JSON.stringify(opts.body) : undefined,
      cache: 'no-store',
    });
  } catch {
    return { ok: false, error: 'ERR_NETWORK' };
  }
  const payload = await res.json().catch(() => null);
  if (!res.ok) {
    const err = (payload as ApiErrorBody | null)?.error;
    return { ok: false, error: err?.code ?? `HTTP_${res.status}` };
  }
  return { ok: true, data: (payload as { data: T }).data };
}

interface StrapiCustomerRow {
  documentId: string;
  name: string;
  name_local?: string;
  phone_last4?: string;
  current_balance_paise: number | string;
  credit_limit_enabled: boolean;
  credit_limit_paise: number | string;
  is_active: boolean;
  last_txn_at?: string;
}

/** Strapi v5's core `find` envelope: `{ data: [...], meta: { pagination } }` — rows have attributes flattened directly onto them. */
export async function listCustomers(query?: string): Promise<CustomerResult<CustomerLite[]>> {
  const url = query ? `/api/customers?q=${encodeURIComponent(query)}` : '/api/customers';
  let res: Response;
  try {
    res = await fetch(url, { headers: { 'X-Device-Id': getDeviceId() }, cache: 'no-store' });
  } catch {
    return { ok: false, error: 'ERR_NETWORK' };
  }
  const payload = await res.json().catch(() => null);
  if (!res.ok) {
    const err = (payload as ApiErrorBody | null)?.error;
    return { ok: false, error: err?.code ?? `HTTP_${res.status}` };
  }
  const rows = ((payload as { data: StrapiCustomerRow[] } | null)?.data ?? []) as StrapiCustomerRow[];
  return {
    ok: true,
    data: rows.map((r) => ({
      id: r.documentId,
      name: r.name,
      name_local: r.name_local,
      phone_last4: r.phone_last4,
      current_balance_paise: Number(r.current_balance_paise),
      credit_limit_enabled: r.credit_limit_enabled,
      credit_limit_paise: Number(r.credit_limit_paise),
      is_active: r.is_active,
      last_txn_at: r.last_txn_at,
    })),
  };
}

/** Bypasses callBff's generic `{ data }`-only unwrapping — this endpoint's response also carries `meta.current_balance_paise`. */
export async function getCustomerLedger(customerId: string): Promise<CustomerResult<{ entries: CustomerLedgerEntry[]; current_balance_paise: number }>> {
  let res: Response;
  try {
    res = await fetch(`/api/customers/${customerId}/ledger`, { headers: { 'X-Device-Id': getDeviceId() }, cache: 'no-store' });
  } catch {
    return { ok: false, error: 'ERR_NETWORK' };
  }
  const payload = await res.json().catch(() => null);
  if (!res.ok) {
    const err = (payload as ApiErrorBody | null)?.error;
    return { ok: false, error: err?.code ?? `HTTP_${res.status}` };
  }
  const body = payload as { data: CustomerLedgerEntry[]; meta?: { current_balance_paise?: number } };
  return { ok: true, data: { entries: body.data ?? [], current_balance_paise: body.meta?.current_balance_paise ?? 0 } };
}

export function recordCustomerPayment(customerId: string, request: RecordPaymentRequest): Promise<CustomerResult<CustomerLedgerEntry>> {
  return callBff(`/api/customers/${customerId}/payment`, { method: 'POST', body: request });
}
