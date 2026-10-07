import type { PosStoreState } from '@/stores/pos-store';
import type { InvoiceTotals } from '@/lib/pricing';
import type { CreateOrderItem, CreateOrderPayment, CreateOrderRequest } from '@/types/checkout';

/** API_CONTRACTS.md §2.1. `is_offline_origin` starts false — outbox-sync flips it when it actually queues. */
export function buildCreateOrderRequest(cart: PosStoreState, totals: InvoiceTotals, shiftId?: string): CreateOrderRequest {
  const items: CreateOrderItem[] = cart.lines.map((line) => ({
    line_group_id: line.line_group_id,
    product_id: line.product_id,
    entered_qty: line.entered_qty,
    entered_unit: line.entered_unit,
    qty_base: line.qty_base,
    unit_price_paise: line.price_source !== 'PRODUCT' ? line.unit_price_paise : undefined,
    price_source: line.price_source,
    line_discount: line.line_discount ?? undefined,
    note: line.note,
  }));

  const payments: CreateOrderPayment[] = cart.payments.map((p) => ({
    method: p.method,
    amount_paise: p.amount_paise,
    tendered_paise: p.tendered_paise,
    reference: p.reference,
  }));

  return {
    client_uuid: cart.cart_uuid,
    counter_id: cart.counter_id || undefined,
    shift_id: shiftId, // REQUIREMENTS.md Rule SH-3 — undefined when shifts aren't enabled for this store
    customer_id: cart.customer?.id,
    order_type: 'SALE',
    items,
    cart_discount: cart.cart_discount ?? undefined,
    payments,
    client_totals: totals as unknown as Record<string, unknown>,
    client_created_at: new Date().toISOString(),
    is_offline_origin: false,
  };
}
