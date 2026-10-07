/**
 * API_CONTRACTS.md §0.2 primitive types + §2 (Fast Checkout). Mirrors the
 * Strapi-side DTOs in backend/src/api/checkout/services/checkout-dto.ts —
 * no shared `packages/contracts` workspace exists yet (Milestone 0's
 * monorepo was never scaffolded), so this is a deliberate, tracked
 * duplication; keep both copies in sync.
 */

export type Paise = number;
export type DecimalString = string;
export type ISODateTime = string;
export type UUID = string;
export type DocumentId = string;

export type ApiUnitCode = 'G' | 'ML' | 'PCS' | 'KG' | 'L' | 'QUINTAL' | 'DOZEN' | 'PACKET' | 'CARTON' | 'BORI' | 'CRATE';
export type ApiPaymentMethod = 'CASH' | 'CARD' | 'UPI' | 'WALLET' | 'CREDIT' | 'BANK_TRANSFER' | 'CHEQUE';

export interface CreateOrderItem {
  line_group_id: UUID;
  product_id: DocumentId;
  entered_qty: DecimalString;
  entered_unit: ApiUnitCode;
  qty_base?: DecimalString;
  batch_id?: DocumentId;
  unit_price_paise?: Paise;
  price_source?: 'PRODUCT' | 'BATCH' | 'UNIT_OVERRIDE' | 'MANUAL';
  line_discount?: { type: 'FLAT' | 'PCT'; value: number };
  note?: string;
}

export interface CreateOrderPayment {
  method: ApiPaymentMethod;
  amount_paise: Paise;
  tendered_paise?: Paise;
  reference?: string;
  provider?: string;
}

export interface CreateOrderRequest {
  client_uuid: UUID;
  counter_id?: DocumentId;
  shift_id?: DocumentId;
  customer_id?: DocumentId;
  order_type: 'SALE' | 'RETURN';
  original_order_id?: DocumentId;

  items: CreateOrderItem[];
  cart_discount?: { type: 'FLAT' | 'PCT'; value: number };
  charges?: Array<{ code: string; label: string; amount_paise: Paise; gst_rate?: number; hsn_code?: string }>;
  payments: CreateOrderPayment[];

  client_totals?: Record<string, unknown>;

  provisional_no?: string;
  client_created_at: ISODateTime;
  is_offline_origin: boolean;
  note?: string;
  approval_tokens?: string[];
}

export interface InvoiceTotalsDTO {
  gross_paise: Paise;
  line_discount_paise: Paise;
  cart_discount_paise: Paise;
  taxable_value_paise: Paise;
  cgst_paise: Paise;
  sgst_paise: Paise;
  igst_paise: Paise;
  cess_paise: Paise;
  charges_paise: Paise;
  round_off_paise: Paise;
  total_paise: Paise;
  paid_paise: Paise;
  credit_paise: Paise;
  tax_breakup: Array<{ gst_rate: number; taxable_paise: Paise; cgst_paise: Paise; sgst_paise: Paise; igst_paise: Paise }>;
  item_count: number;
  total_qty_display: string;
}

export interface OrderItemResult {
  line_group_id: UUID;
  line_no: number;
  product_id: DocumentId;
  product_name: string;
  product_name_local?: string;
  hsn_code?: string;
  batch_id?: DocumentId;
  batch_no?: string;
  expiry_date?: string;
  entered_qty: DecimalString;
  entered_unit: ApiUnitCode;
  qty_base: DecimalString;
  base_unit: string;
  unit_price_paise: Paise;
  price_source: string;
  gross_paise: Paise;
  line_discount_paise: Paise;
  cart_discount_share_paise: Paise;
  taxable_value_paise: Paise;
  gst_rate: number;
  cgst_paise: Paise;
  sgst_paise: Paise;
  igst_paise: Paise;
  line_total_paise: Paise;
  stock_after_base: DecimalString;
  was_oversold: boolean;
}

export interface PrintPayload {
  template: 'RECEIPT_58' | 'RECEIPT_80' | 'A5_INVOICE';
  language: 'hi' | 'en';
  render_mode: 'TEXT' | 'RASTER';
  copies: number;
  mark_provisional: boolean;
  header: { store_name: string; address_lines: string[]; phone?: string; gstin?: string; logo_url?: string };
  meta: {
    invoice_no: string;
    date_display: string;
    time_display: string;
    cashier: string;
    counter?: string;
    customer?: { name: string; phone_masked?: string };
  };
  lines: Array<{ name: string; qty_display: string; rate_display: string; amount_display: string; batch_display?: string; note?: string }>;
  totals_block: Array<{ label: string; value: string; emphasis?: boolean }>;
  tax_block?: Array<{ rate: string; taxable: string; cgst: string; sgst: string }>;
  payments_block: Array<{ label: string; value: string }>;
  credit_block?: { previous_balance: string; this_bill: string; new_balance: string };
  footer_lines: string[];
  qr?: { type: 'UPI' | 'INVOICE_LINK'; data: string };
  open_drawer: boolean;
}

export interface CreateOrderResponse {
  order: {
    id: DocumentId;
    invoice_no: string;
    provisional_no?: string;
    financial_year: string;
    business_date: string;
    server_created_at: ISODateTime;
    status: 'COMPLETED';
    settlement_status: 'SETTLED' | 'PARTIALLY_SETTLED' | 'UNPAID';
    supply_type: 'INTRA_STATE' | 'INTER_STATE';
  };
  totals: InvoiceTotalsDTO;
  items: OrderItemResult[];
  payments: Array<{ method: ApiPaymentMethod; amount_paise: Paise; change_paise?: Paise }>;
  customer?: { id: DocumentId; name: string; balance_before_paise: Paise; balance_after_paise: Paise; credit_headroom_paise: Paise | null };
  warnings?: Array<{ code: string; message: string; item_index?: number }>;
  print_payload: PrintPayload;
}

export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
    message_localized?: { hi?: string; en?: string };
    field?: string;
    details?: Record<string, unknown>;
    resolutions?: Array<{ action: string; label: string; requires_permission?: string; payload_patch?: Record<string, unknown> }>;
    trace_id: string;
  };
}
