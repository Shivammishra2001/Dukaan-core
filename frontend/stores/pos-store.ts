import { create } from 'zustand';
import Decimal from 'decimal.js';
import type {
  ActionResult,
  CartLine,
  CartStatus,
  Charge,
  CustomerLite,
  Discount,
  ParkedCart,
  Payment,
  Product,
  UnitCode,
} from '@/types/pos';
import { PosError, findConversion, toBase, toProductSnapshot, validateEnteredQty } from '@/lib/units';
import { exceedsMrp, type InvoiceTotals } from '@/lib/pricing';
import { buildCreateOrderRequest } from '@/lib/checkout-request';
import { submitOrder } from '@/lib/sync/outbox-sync';
import { useShiftStore } from '@/stores/shift-store';
import type { CreateOrderResponse } from '@/types/checkout';

/**
 * SYSTEM_ARCHITECTURE.md §2.2/§2.3 — this store is *only* the cart machine
 * (Rule FE-3). It never holds catalogue/product lists (those are passed
 * into actions by the caller, who owns them via lib/mock-data.ts today and
 * Dexie/IndexedDB from Milestone 3 on) and never holds server-fetched
 * lists. Totals are intentionally NOT stored here — they're a derived
 * selector; see hooks/use-cart-totals.ts, which calls the pure
 * lib/pricing.ts#computeTotals (Rule FE-4).
 *
 * Persistence: the spec calls for Zustand's `persist` middleware backed by
 * IndexedDB (not localStorage — see ADR-07). That storage engine belongs to
 * the Milestone 3 offline work (Dexie schema, outbox) and isn't wired yet;
 * wiring `persist` with a localStorage adapter now would just have to be
 * ripped out, so this store is memory-only until then.
 */

function newCartUuid(): string {
  return crypto.randomUUID();
}

function emptyCart(storeId: string, counterId: string, shiftId: string | null) {
  return {
    cart_uuid: newCartUuid(),
    store_id: storeId,
    counter_id: counterId,
    shift_id: shiftId,
    lines: [] as CartLine[],
    customer: null as CustomerLite | null,
    cart_discount: null as Discount | null,
    charges: [] as Charge[],
    payments: [] as Payment[],
    status: 'ACTIVE' as CartStatus,
  };
}

export interface PosStoreState {
  cart_uuid: string;
  store_id: string;
  counter_id: string;
  shift_id: string | null;
  lines: CartLine[];
  customer: CustomerLite | null;
  cart_discount: Discount | null;
  charges: Charge[];
  payments: Payment[];
  status: CartStatus;
  parked_carts: ParkedCart[];
  last_error: string | null;

  /**
   * The cart is created at module-load time with placeholder ids ('store-k1'/
   * 'counter-1', see emptyCart's initial call below) since the real,
   * session-derived store/counter aren't known until after login resolves.
   * Call this once they are (see app/(authenticated)/pos/page.tsx) so
   * checkout submits a counter_id that actually belongs to this store —
   * submitting the placeholder is exactly what produced
   * ERR_STORE_MISMATCH ("Counter counter-1 does not belong to this store")
   * on every real checkout. If the ids actually change (a real store/counter
   * switch, not just the first resolution from placeholder->real), the cart
   * is cleared: lines already added reference the old store's products and
   * are not valid against the new one.
   */
  setStoreContext: (storeId: string, counterId: string) => void;
  addByBarcode: (barcode: string, catalog: Product[]) => ActionResult;
  addByProduct: (product: Product, opts?: { enteredQty?: string; unit?: UnitCode }) => ActionResult;
  setLineQty: (lineId: string, enteredQty: string, unit?: UnitCode) => ActionResult;
  removeLine: (lineId: string) => void;
  applyLineDiscount: (lineId: string, discount: Discount | null) => ActionResult;
  applyCartDiscount: (discount: Discount | null) => ActionResult;
  overrideLinePrice: (lineId: string, pricePaise: number, opts?: { approved?: boolean }) => ActionResult;
  bindCustomer: (customer: CustomerLite) => void;
  clearCustomer: () => void;
  addPayment: (payment: Payment) => ActionResult;
  removePayment: (index: number) => void;
  park: (label: string) => void;
  resume: (cartUuid: string) => void;
  submit: (
    totals: InvoiceTotals,
    storeCode: string
  ) => Promise<ActionResult & { invoiceNo?: string; offline?: boolean; response?: CreateOrderResponse }>;
  reset: () => void;
  /** Drops the cart and parked carts and returns to placeholder store/counter ids — for a store/user session change (lib/session-scope.ts). */
  resetForSession: () => void;
  clearError: () => void;
}

/** DS-4 placeholder: real ceilings are per-role, server-enforced (no auth wired in this milestone). */
const DEFAULT_DISCOUNT_MAX_PCT = 20;

export const usePosStore = create<PosStoreState>((set, get) => ({
  ...emptyCart('store-k1', 'counter-1', null),
  parked_carts: [],
  last_error: null,

  setStoreContext: (storeId, counterId) => {
    const state = get();
    if (state.store_id === storeId && state.counter_id === counterId) return;
    const hasLines = state.lines.length > 0;
    set(hasLines ? emptyCart(storeId, counterId, state.shift_id) : { ...state, store_id: storeId, counter_id: counterId });
  },

  addByBarcode: (barcode, catalog) => {
    const product = catalog.find((p) => p.barcode === barcode || p.sku === barcode);
    // Not in REQUIREMENTS.md §7.1's catalogue (that list is server-validation
    // codes) — this is a client-side lookup miss, so it gets its own code.
    if (!product) return { ok: false, error: 'ERR_PRODUCT_NOT_FOUND' } satisfies ActionResult;
    return get().addByProduct(product);
  },

  addByProduct: (product, opts) => {
    try {
      const unit = opts?.unit ?? product.default_sale_unit;
      const enteredQty = opts?.enteredQty ?? '1';
      const snapshot = toProductSnapshot(product);
      validateEnteredQty(snapshot, enteredQty);
      const qtyBaseAdd = toBase(enteredQty, unit, snapshot.unit_conversions);

      const existing = get().lines.find(
        (l) => l.product_id === product.id && l.entered_unit === unit && l.price_source === 'PRODUCT' && !l.line_discount
      );

      if (existing) {
        const newEnteredQty = new Decimal(existing.entered_qty).plus(enteredQty);
        validateEnteredQty(snapshot, newEnteredQty);
        const newQtyBase = new Decimal(existing.qty_base).plus(qtyBaseAdd).toDecimalPlaces(4, Decimal.ROUND_HALF_UP);
        set({
          lines: get().lines.map((l) =>
            l.line_id === existing.line_id
              ? { ...l, entered_qty: newEnteredQty.toString(), qty_base: newQtyBase.toString() }
              : l
          ),
        });
        return { ok: true };
      }

      findConversion(snapshot.unit_conversions, snapshot.pricing_unit); // fail fast if pricing_unit isn't convertible
      // Rule PR-3 tier 2: a unit-specific override wins if the chosen sale unit carries one.
      const chosenUnitConv = findConversion(snapshot.unit_conversions, unit);
      const lineId = newCartUuid();
      const line: CartLine =
        chosenUnitConv.price_override_paise != null
          ? {
              line_id: lineId,
              line_group_id: lineId,
              product_id: product.id,
              product_snapshot: snapshot,
              entered_qty: enteredQty,
              entered_unit: unit,
              qty_base: qtyBaseAdd.toString(),
              unit_price_paise: chosenUnitConv.price_override_paise,
              price_source: 'UNIT_OVERRIDE',
              line_discount: null,
              discount_exempt: snapshot.discount_exempt,
              mrp_override_approved: false,
              note: undefined,
            }
          : {
              line_id: lineId,
              line_group_id: lineId,
              product_id: product.id,
              product_snapshot: snapshot,
              entered_qty: enteredQty,
              entered_unit: unit,
              qty_base: qtyBaseAdd.toString(),
              unit_price_paise: product.sell_rate_paise,
              price_source: 'PRODUCT',
              line_discount: null,
              discount_exempt: snapshot.discount_exempt,
              mrp_override_approved: false,
              note: undefined,
            };
      if (exceedsMrp(line) && !line.mrp_override_approved) {
        return { ok: false, error: 'ERR_PRICE_ABOVE_MRP' };
      }

      set({ lines: [...get().lines, line] });
      return { ok: true };
    } catch (err) {
      if (err instanceof PosError) return { ok: false, error: err.code };
      throw err;
    }
  },

  setLineQty: (lineId, enteredQty, unit) => {
    const line = get().lines.find((l) => l.line_id === lineId);
    if (!line) return { ok: false, error: 'ERR_QTY_INVALID' };
    try {
      const targetUnit = unit ?? line.entered_unit;
      validateEnteredQty(line.product_snapshot, enteredQty);
      const qtyBase = toBase(enteredQty, targetUnit, line.product_snapshot.unit_conversions);
      set({
        lines: get().lines.map((l) =>
          l.line_id === lineId ? { ...l, entered_qty: enteredQty, entered_unit: targetUnit, qty_base: qtyBase.toString() } : l
        ),
      });
      return { ok: true };
    } catch (err) {
      if (err instanceof PosError) return { ok: false, error: err.code };
      throw err;
    }
  },

  removeLine: (lineId) => set({ lines: get().lines.filter((l) => l.line_id !== lineId) }),

  applyLineDiscount: (lineId, discount) => {
    if (discount && discount.value < 0) return { ok: false, error: 'ERR_QTY_INVALID' };
    if (discount?.type === 'PCT' && discount.value > DEFAULT_DISCOUNT_MAX_PCT) {
      return { ok: false, error: 'ERR_DISCOUNT_ABOVE_ROLE_CAP' };
    }
    set({ lines: get().lines.map((l) => (l.line_id === lineId ? { ...l, line_discount: discount } : l)) });
    return { ok: true };
  },

  applyCartDiscount: (discount) => {
    if (discount && discount.value < 0) return { ok: false, error: 'ERR_QTY_INVALID' };
    if (discount?.type === 'PCT' && discount.value > DEFAULT_DISCOUNT_MAX_PCT) {
      return { ok: false, error: 'ERR_DISCOUNT_ABOVE_ROLE_CAP' };
    }
    set({ cart_discount: discount });
    return { ok: true };
  },

  overrideLinePrice: (lineId, pricePaise, opts) => {
    if (pricePaise < 0) return { ok: false, error: 'ERR_QTY_INVALID' };
    const line = get().lines.find((l) => l.line_id === lineId);
    if (!line) return { ok: false, error: 'ERR_QTY_INVALID' };
    const candidate: CartLine = {
      ...line,
      unit_price_paise: pricePaise,
      price_source: 'MANUAL',
      mrp_override_approved: opts?.approved ?? false,
    };
    if (exceedsMrp(candidate) && !candidate.mrp_override_approved) {
      return { ok: false, error: 'ERR_PRICE_ABOVE_MRP' };
    }
    set({ lines: get().lines.map((l) => (l.line_id === lineId ? candidate : l)) });
    return { ok: true };
  },

  bindCustomer: (customer) => set({ customer }),
  clearCustomer: () => set({ customer: null }),

  addPayment: (payment) => {
    if (payment.amount_paise <= 0) return { ok: false, error: 'ERR_QTY_INVALID' };
    if (payment.method === 'CREDIT' && !get().customer) {
      return { ok: false, error: 'ERR_CUSTOMER_REQUIRED' };
    }
    set({ payments: [...get().payments, payment] });
    return { ok: true };
  },

  removePayment: (index) => set({ payments: get().payments.filter((_, i) => i !== index) }),

  park: (label) => {
    const state = get();
    if (state.lines.length === 0) return;
    const parked: ParkedCart = {
      cart_uuid: state.cart_uuid,
      label,
      parked_at: new Date().toISOString(),
      lines: state.lines,
      customer: state.customer,
      cart_discount: state.cart_discount,
      payments: state.payments,
    };
    set({
      parked_carts: [...state.parked_carts, parked],
      ...emptyCart(state.store_id, state.counter_id, state.shift_id),
    });
  },

  resume: (cartUuid) => {
    const state = get();
    const target = state.parked_carts.find((p) => p.cart_uuid === cartUuid);
    if (!target) return;

    let remainingParked = state.parked_carts.filter((p) => p.cart_uuid !== cartUuid);
    if (state.lines.length > 0) {
      remainingParked = [
        ...remainingParked,
        {
          cart_uuid: state.cart_uuid,
          label: 'Auto-parked',
          parked_at: new Date().toISOString(),
          lines: state.lines,
          customer: state.customer,
          cart_discount: state.cart_discount,
          payments: state.payments,
        },
      ];
    }

    set({
      cart_uuid: target.cart_uuid,
      store_id: state.store_id,
      counter_id: state.counter_id,
      shift_id: state.shift_id,
      lines: target.lines,
      customer: target.customer,
      cart_discount: target.cart_discount,
      charges: [],
      payments: target.payments,
      status: 'ACTIVE',
      parked_carts: remainingParked,
    });
  },

  submit: async (totals, storeCode) => {
    const state = get();
    if (state.lines.length === 0) return { ok: false, error: 'ERR_EMPTY_CART' };
    const paid = state.payments.reduce((sum, p) => sum + p.amount_paise, 0);
    if (paid !== totals.total_paise) return { ok: false, error: 'ERR_PAYMENT_MISMATCH' };

    set({ status: 'SUBMITTING', last_error: null });

    // SYSTEM_ARCHITECTURE.md §4.1 (online) / §5 (offline outbox). Online
    // hits /api/pos/checkout directly; offline (or a network failure)
    // queues to the Dexie outbox — either way this only resolves `ok: true`
    // once the order is durably persisted somewhere (Rule FE-5).
    const shiftId = useShiftStore.getState().shift?.id;
    const request = buildCreateOrderRequest(state, totals, shiftId);
    const outcome = await submitOrder(request, storeCode);

    if (!outcome.ok) {
      set({ status: 'ACTIVE', last_error: outcome.error ?? 'ERR_UNKNOWN' });
      return { ok: false, error: outcome.error };
    }

    set({ status: 'SUBMITTED' });
    return { ok: true, invoiceNo: outcome.invoiceNo, offline: outcome.offline, response: outcome.response };
  },

  reset: () => {
    const state = get();
    set(emptyCart(state.store_id, state.counter_id, state.shift_id));
  },

  resetForSession: () => set({ ...emptyCart('store-k1', 'counter-1', null), parked_carts: [], last_error: null }),

  clearError: () => set({ last_error: null }),
}));
