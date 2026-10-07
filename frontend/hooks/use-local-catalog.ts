import { useLiveQuery } from 'dexie-react-hooks';
import { posDb } from '@/lib/db/pos-db';
import type { Product } from '@/types/pos';

/**
 * REQUIREMENTS.md OFF-005: "Stock shown offline is last-known-synced minus
 * locally queued sales." Overlays Dexie's `local_catalog` (decremented by
 * outbox-sync as offline bills are queued) on top of the static seed
 * catalogue so consecutive offline sales visibly deplete stock in the UI.
 */
export function useLocalStockOverrides(): Map<string, number> {
  const rows =
    useLiveQuery(async () => {
      if (!posDb) return [];
      return posDb.local_catalog.toArray();
    }, []) ?? [];
  return new Map(rows.map((r) => [r.product_id, r.stock_base]));
}

export function applyLocalStockOverrides(products: Product[], overrides: Map<string, number>): Product[] {
  if (overrides.size === 0) return products;
  return products.map((p) => (overrides.has(p.id) ? { ...p, stock_base: overrides.get(p.id)! } : p));
}
