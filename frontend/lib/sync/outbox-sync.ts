import { requireDb } from '@/lib/db/pos-db';
import { buildProvisionalNo, getDeviceId, isOnline } from './device';
import { getMockStockBase } from '@/lib/mock-data';
import { getActiveStoreId } from './active-store';
import type { ApiErrorBody, CreateOrderRequest, CreateOrderResponse } from '@/types/checkout';

/**
 * REQUIREMENTS.md §6 (Offline Behaviour) + SYSTEM_ARCHITECTURE.md §5
 * (Offline Sync Protocol), scoped to Milestone 3's ask: online submits go
 * straight to the checkout API; offline (or a network failure) queues to
 * the Dexie outbox and replays on reconnect. The fuller batched
 * `/api/sync/push` envelope (§5.3, multi-kind SETTLEMENT/ADJUSTMENT/etc.)
 * is NOT implemented — each outbox order replays through the same
 * single-order checkout endpoint it would have used online, each with its
 * own Idempotency-Key, which is exactly what Rule SY-1 requires for
 * exactly-once delivery without needing the batch protocol.
 */

export interface SubmitOutcome {
  ok: boolean;
  offline: boolean;
  invoiceNo?: string;
  response?: CreateOrderResponse;
  error?: string;
}

type CheckoutFetchResult =
  | { ok: true; data: CreateOrderResponse }
  | { ok: false; networkError: true }
  | { ok: false; networkError: false; error: ApiErrorBody['error'] };

async function postCheckout(request: CreateOrderRequest): Promise<CheckoutFetchResult> {
  let res: Response;
  try {
    res = await fetch('/api/pos/checkout', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Idempotency-Key': request.client_uuid,
        'X-Device-Id': getDeviceId(),
      },
      body: JSON.stringify(request),
    });
  } catch {
    return { ok: false, networkError: true };
  }

  if (!res.ok) {
    let body: ApiErrorBody | null = null;
    try {
      body = await res.json();
    } catch {
      // non-JSON error body (e.g. a proxy/502 page) — fall through to the default below
    }
    return {
      ok: false,
      networkError: false,
      error: body?.error ?? { code: 'ERR_UNKNOWN', message: `HTTP ${res.status}`, trace_id: '' },
    };
  }

  const payload = (await res.json()) as { data: CreateOrderResponse };
  return { ok: true, data: payload.data };
}

async function decrementLocalCatalog(items: CreateOrderRequest['items']) {
  const db = requireDb();
  await db.transaction('rw', db.local_catalog, async () => {
    for (const item of items) {
      const qty = Number(item.qty_base ?? item.entered_qty);
      if (!Number.isFinite(qty)) continue;
      const existing = await db.local_catalog.get(item.product_id);
      const baseline = existing?.stock_base ?? getMockStockBase(item.product_id) ?? 0;
      await db.local_catalog.put({ product_id: item.product_id, stock_base: Math.max(0, baseline - qty), synced_at: Date.now() });
    }
  });
}

async function queueOffline(request: CreateOrderRequest, storeCode: string): Promise<SubmitOutcome> {
  const db = requireDb();
  const provisionalNo = buildProvisionalNo(storeCode);
  const payload: CreateOrderRequest = { ...request, is_offline_origin: true, provisional_no: provisionalNo };

  await db.offline_orders.add({
    client_uuid: payload.client_uuid,
    payload,
    store_id: getActiveStoreId() ?? undefined,
    status: 'PENDING',
    attempts: 0,
    next_attempt_at: Date.now(),
    created_at: Date.now(),
  });

  await decrementLocalCatalog(payload.items);

  return { ok: true, offline: true, invoiceNo: provisionalNo };
}

/**
 * The one entry point checkout-modal.tsx calls. Online-first: only falls
 * back to the outbox on an actual network failure (or when the browser
 * already reports offline) — a business rejection reached the server and
 * is surfaced directly, since queuing it would just fail identically on
 * replay (REQUIREMENTS.md OFF-002 draws this same line).
 */
export async function submitOrder(request: CreateOrderRequest, storeCode: string): Promise<SubmitOutcome> {
  if (isOnline()) {
    const result = await postCheckout(request);
    if (result.ok) {
      return { ok: true, offline: false, invoiceNo: result.data.order.invoice_no, response: result.data };
    }
    if (!result.networkError) {
      return { ok: false, offline: false, error: result.error.code };
    }
    // networkError — fall through to the offline path below.
  }

  return queueOffline(request, storeCode);
}

function backoffMs(attempts: number): number {
  return Math.min(30_000, 1_000 * 2 ** attempts);
}

let replayInFlight = false;

/**
 * Rule SY-2: sequential, continue-on-error. A network failure stops the
 * whole pass (everything after it would fail the same way); a business
 * rejection just marks that one item FAILED and moves on.
 */
export async function replayOutbox(): Promise<void> {
  if (replayInFlight) return;
  if (!isOnline()) return;
  // The BFF binds every checkout to the *current* session's store, so an order
  // queued under another store would only 403 with ERR_STORE_MISMATCH — leave
  // it queued for when that store logs in again.
  const storeId = getActiveStoreId();
  if (!storeId) return;

  const db = requireDb();
  replayInFlight = true;
  try {
    const now = Date.now();
    const due = (await db.offline_orders.where('status').anyOf(['PENDING', 'FAILED']).sortBy('seq')).filter(
      (r) => r.next_attempt_at <= now && r.store_id === storeId
    );

    for (const record of due) {
      await db.offline_orders.update(record.seq!, { status: 'INFLIGHT' });
      const result = await postCheckout(record.payload);

      if (result.ok) {
        await db.offline_orders.update(record.seq!, { status: 'DONE', server_result: result.data });
        continue;
      }

      if (result.networkError) {
        const attempts = record.attempts + 1;
        await db.offline_orders.update(record.seq!, {
          status: 'PENDING',
          attempts,
          next_attempt_at: Date.now() + backoffMs(attempts),
          last_error: 'NETWORK_ERROR',
        });
        break; // stop this pass; later items would fail the same way right now
      }

      await db.offline_orders.update(record.seq!, {
        status: 'FAILED',
        attempts: record.attempts + 1,
        next_attempt_at: Date.now() + backoffMs(record.attempts + 1),
        last_error: result.error.code,
      });
    }
  } finally {
    replayInFlight = false;
  }
}

/** Wires reconnect + periodic replay. Call once from the POS page; returns a cleanup function. */
export function startOutboxWorker(intervalMs = 20_000): () => void {
  if (typeof window === 'undefined') return () => {};

  const onOnline = () => void replayOutbox();
  window.addEventListener('online', onOnline);
  const interval = window.setInterval(() => {
    if (isOnline()) void replayOutbox();
  }, intervalMs);

  void replayOutbox(); // catch up on anything queued in a previous session

  return () => {
    window.removeEventListener('online', onOnline);
    window.clearInterval(interval);
  };
}

/** Rule SH-4: the shift-close gate's pending count. Not yet DONE means still queued to sync. */
export async function getPendingOutboxCount(): Promise<number> {
  if (!requireDbSafe()) return 0;
  const storeId = getActiveStoreId();
  return requireDb()
    .offline_orders.where('status')
    .anyOf(['PENDING', 'FAILED', 'INFLIGHT'])
    .filter((r) => r.store_id === storeId)
    .count();
}

function requireDbSafe(): boolean {
  try {
    requireDb();
    return true;
  } catch {
    return false; // SSR / no IndexedDB
  }
}
