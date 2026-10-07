import Dexie, { type Table } from 'dexie';
import type { CreateOrderRequest, CreateOrderResponse } from '@/types/checkout';
import type { CustomerLite } from '@/types/pos';

/**
 * SYSTEM_ARCHITECTURE.md §2.4 (Dexie offline schema) + §5.2 (outbox item
 * lifecycle), scoped down to what Milestone 3 asked for: `offline_orders`
 * (outbox queue), `local_catalog` (cached product/batch stock), and
 * `customers_cache`. The fuller schema (search_index, sync_state, per-unit
 * conversions, etc.) is Milestone 3's broader offline-engine sprint and
 * isn't built here — this is exactly the checkout outbox path.
 */

export type OutboxStatus = 'PENDING' | 'INFLIGHT' | 'FAILED' | 'DONE';

export interface OfflineOrderRecord {
  seq?: number; // auto-increment primary key: replay order (Rule SY-2)
  /** The Idempotency-Key (Rule SY-1: exactly-once, keyed on this), unique-indexed. */
  client_uuid: string;
  payload: CreateOrderRequest;
  /** Session store (documentId) the order was rung up in; replay only happens under that store's session. Absent on records queued before this field existed. */
  store_id?: string;
  status: OutboxStatus;
  attempts: number;
  next_attempt_at: number; // epoch ms; exponential backoff gate
  created_at: number;
  last_error?: string;
  server_result?: CreateOrderResponse;
}

/** Local, per-device mirror of stock levels so consecutive offline bills reflect depletion (REQUIREMENTS.md OFF-005). */
export interface LocalCatalogStockRecord {
  product_id: string; // Product.id
  stock_base: number;
  synced_at: number;
}

export interface CustomerCacheRecord {
  customer_id: string; // CustomerLite.id
  data: CustomerLite;
  synced_at: number;
}

class PosDatabase extends Dexie {
  offline_orders!: Table<OfflineOrderRecord, number>;
  local_catalog!: Table<LocalCatalogStockRecord, string>;
  customers_cache!: Table<CustomerCacheRecord, string>;

  constructor() {
    super('dukaan-pos');
    this.version(1).stores({
      offline_orders: '++seq, &client_uuid, status, next_attempt_at',
      local_catalog: 'product_id, synced_at',
      customers_cache: 'customer_id, synced_at',
    });
  }
}

// Dexie touches IndexedDB at construction time — guard for SSR/build (Next.js
// evaluates modules on the server too, where `indexedDB` doesn't exist).
export const posDb: PosDatabase | null = typeof window !== 'undefined' ? new PosDatabase() : null;

export function requireDb(): PosDatabase {
  if (!posDb) throw new Error('pos-db is only available in the browser');
  return posDb;
}
