import { useMemo } from 'react';
import { usePosStore } from '@/stores/pos-store';
import { computeTotals } from '@/lib/pricing';
import type { RoundOffMode, SupplyType } from '@/types/pos';

/**
 * SYSTEM_ARCHITECTURE.md §2.3: totals are a derived selector, never stored
 * on the cart. Recomputed on every relevant state change via the same pure
 * pipeline (lib/pricing.ts) that Milestone 1's checkout.service will run
 * server-side (Rule FE-4).
 */
export function useCartTotals(supplyType: SupplyType, roundOffMode: RoundOffMode) {
  const lines = usePosStore((s) => s.lines);
  const cartDiscount = usePosStore((s) => s.cart_discount);
  const charges = usePosStore((s) => s.charges);

  return useMemo(
    () =>
      computeTotals({
        lines,
        cart_discount: cartDiscount,
        charges,
        supply_type: supplyType,
        round_off_mode: roundOffMode,
      }),
    [lines, cartDiscount, charges, supplyType, roundOffMode]
  );
}
