import { getDeviceId } from '@/lib/sync/device';
import type { ApiErrorBody } from '@/types/checkout';
import type { CounterLite } from '@/types/pos';

export type CounterResult<T> = { ok: true; data: T } | { ok: false; error: string };

interface StrapiCounterRow {
  documentId: string;
  code: string;
  name: string;
}

/** GET /api/pos/counters — the session's store's active counters, primary (lowest code) first. */
export async function listCounters(): Promise<CounterResult<CounterLite[]>> {
  let res: Response;
  try {
    res = await fetch('/api/pos/counters', { headers: { 'X-Device-Id': getDeviceId() }, cache: 'no-store' });
  } catch {
    return { ok: false, error: 'ERR_NETWORK' };
  }
  const payload = await res.json().catch(() => null);
  if (!res.ok) {
    const err = (payload as ApiErrorBody | null)?.error;
    return { ok: false, error: err?.code ?? `HTTP_${res.status}` };
  }
  const rows = ((payload as { data: StrapiCounterRow[] } | null)?.data ?? []) as StrapiCounterRow[];
  return { ok: true, data: rows.map((r) => ({ id: r.documentId, code: r.code, name: r.name })) };
}
