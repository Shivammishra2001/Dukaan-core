import type { InvoiceTotals } from '@/lib/pricing';
import type { PosStoreState } from '@/stores/pos-store';
import type { CreateOrderResponse, OrderItemResult, PrintPayload } from '@/types/checkout';
import type { StoreConfig } from '@/types/pos';
import { formatPaise } from '@/lib/money';

/**
 * When a bill is queued to the offline outbox, there is no server
 * `CreateOrderResponse` yet (Rule SY-4: the real one arrives on sync).
 * Milestone 5's PDF/print/WhatsApp features must work immediately and
 * "100% offline-safe" regardless — this builds an equivalent shape from
 * client-only data (the cart, the already-computed client totals, and the
 * provisional invoice number), so the receipt/PDF/share code paths never
 * need to know whether the order has actually reached the server yet.
 */
export function buildLocalOrderResponse(
  cart: PosStoreState,
  totals: InvoiceTotals,
  invoiceNo: string,
  storeConfig: StoreConfig,
  cashierName: string,
  isProvisional: boolean
): CreateOrderResponse {
  const now = new Date();

  const items: OrderItemResult[] = cart.lines.map((line, i) => {
    const t = totals.lines[i];
    return {
      line_group_id: line.line_group_id,
      line_no: i + 1,
      product_id: line.product_id,
      product_name: line.product_snapshot.name,
      product_name_local: line.product_snapshot.name_local,
      entered_qty: line.entered_qty,
      entered_unit: line.entered_unit,
      qty_base: line.qty_base,
      base_unit: line.product_snapshot.base_unit,
      unit_price_paise: line.unit_price_paise,
      price_source: line.price_source,
      gross_paise: t?.gross_paise ?? 0,
      line_discount_paise: t?.line_discount_paise ?? 0,
      cart_discount_share_paise: t?.cart_discount_share_paise ?? 0,
      taxable_value_paise: t?.taxable_value_paise ?? 0,
      gst_rate: line.product_snapshot.gst_rate,
      cgst_paise: t?.cgst_paise ?? 0,
      sgst_paise: t?.sgst_paise ?? 0,
      igst_paise: t?.igst_paise ?? 0,
      line_total_paise: t?.line_total_paise ?? 0,
      stock_after_base: '0', // unknown client-side — the server allocates batches at sync time (Rule SY-3)
      was_oversold: false,
    };
  });

  const gstSummary = totals.gst_summary ?? [];

  const printPayload: PrintPayload = {
    template: 'RECEIPT_58',
    language: 'en',
    render_mode: 'TEXT',
    copies: 1,
    mark_provisional: isProvisional,
    header: { store_name: storeConfig.store_name, address_lines: [] },
    meta: {
      invoice_no: invoiceNo,
      date_display: now.toLocaleDateString('en-IN'),
      time_display: now.toLocaleTimeString('en-IN'),
      cashier: cashierName,
      counter: storeConfig.counter_name,
      customer: cart.customer ? { name: cart.customer.name, phone_masked: cart.customer.phone_last4 ? `••${cart.customer.phone_last4}` : undefined } : undefined,
    },
    lines: cart.lines.map((line, i) => ({
      name: line.product_snapshot.name,
      qty_display: `${line.entered_qty} ${line.entered_unit}`,
      rate_display: (line.unit_price_paise / 100).toFixed(2),
      amount_display: formatPaise(totals.lines[i]?.line_total_paise ?? 0).replace('₹', ''),
    })),
    totals_block: [
      { label: 'Subtotal', value: formatPaise(totals.taxable_value_paise).replace('₹', '') },
      { label: 'Tax', value: formatPaise(totals.tax_paise).replace('₹', '') },
      { label: 'Round off', value: formatPaise(totals.round_off_paise).replace('₹', '') },
      { label: 'Total', value: formatPaise(totals.total_paise).replace('₹', ''), emphasis: true },
    ],
    tax_block: gstSummary.map((t) => ({
      rate: `${t.rate}%`,
      taxable: (t.taxable_paise / 100).toFixed(2),
      cgst: (t.cgst_paise / 100).toFixed(2),
      sgst: (t.sgst_paise / 100).toFixed(2),
    })),
    payments_block: cart.payments.map((p) => ({ label: p.method, value: formatPaise(p.amount_paise).replace('₹', '') })),
    credit_block: cart.customer && cart.payments.some((p) => p.method === 'CREDIT')
      ? {
          previous_balance: formatPaise(cart.customer.current_balance_paise).replace('₹', ''),
          this_bill: formatPaise(cart.payments.filter((p) => p.method === 'CREDIT').reduce((s, p) => s + p.amount_paise, 0)).replace('₹', ''),
          new_balance: formatPaise(
            cart.customer.current_balance_paise + cart.payments.filter((p) => p.method === 'CREDIT').reduce((s, p) => s + p.amount_paise, 0)
          ).replace('₹', ''),
        }
      : undefined,
    footer_lines: ['Thank you for shopping with us!'],
    open_drawer: cart.payments.some((p) => p.method === 'CASH'),
  };

  return {
    order: {
      id: cart.cart_uuid,
      invoice_no: invoiceNo,
      provisional_no: isProvisional ? invoiceNo : undefined,
      financial_year: '',
      business_date: now.toISOString().slice(0, 10),
      server_created_at: now.toISOString(),
      status: 'COMPLETED',
      settlement_status: cart.payments.some((p) => p.method === 'CREDIT') ? 'PARTIALLY_SETTLED' : 'SETTLED',
      supply_type: storeConfig.supply_type,
    },
    totals: {
      gross_paise: totals.gross_paise,
      line_discount_paise: totals.line_discount_paise,
      cart_discount_paise: totals.cart_discount_paise,
      taxable_value_paise: totals.taxable_value_paise,
      cgst_paise: totals.cgst_paise,
      sgst_paise: totals.sgst_paise,
      igst_paise: totals.igst_paise,
      cess_paise: 0,
      charges_paise: totals.charges_paise,
      round_off_paise: totals.round_off_paise,
      total_paise: totals.total_paise,
      paid_paise: cart.payments.filter((p) => p.method !== 'CREDIT').reduce((s, p) => s + p.amount_paise, 0),
      credit_paise: cart.payments.filter((p) => p.method === 'CREDIT').reduce((s, p) => s + p.amount_paise, 0),
      tax_breakup: gstSummary.map((t) => ({ gst_rate: t.rate, taxable_paise: t.taxable_paise, cgst_paise: t.cgst_paise, sgst_paise: t.sgst_paise, igst_paise: totals.igst_paise > 0 ? t.tax_paise : 0 })),
      item_count: cart.lines.length,
      total_qty_display: `${cart.lines.length} item(s)`,
    },
    items,
    payments: cart.payments.map((p) => ({ method: p.method, amount_paise: p.amount_paise, change_paise: p.change_paise })),
    customer: cart.customer
      ? {
          id: cart.customer.id,
          name: cart.customer.name,
          balance_before_paise: cart.customer.current_balance_paise,
          balance_after_paise:
            cart.customer.current_balance_paise + cart.payments.filter((p) => p.method === 'CREDIT').reduce((s, p) => s + p.amount_paise, 0),
          credit_headroom_paise: cart.customer.credit_limit_enabled ? cart.customer.credit_limit_paise - cart.customer.current_balance_paise : null,
        }
      : undefined,
    print_payload: printPayload,
  };
}
