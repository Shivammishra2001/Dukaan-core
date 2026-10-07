import type { DocumentId, Paise, UUID } from './checkout';

/** Mirrors backend/src/api/supplier + purchase-inward + b2b-dispatch response shapes. */

export interface SupplierLite {
  id: DocumentId;
  name: string;
  phone_last4?: string;
  gstin?: string;
  current_balance_paise: Paise;
}

export type SupplierPaymentMethod = 'CASH' | 'UPI' | 'BANK_TRANSFER' | 'CHEQUE';

export interface RecordSupplierPaymentRequest {
  amount_paise: number;
  method: SupplierPaymentMethod;
  reference?: string;
  note?: string;
}

export interface SupplierLedgerEntry {
  id: number;
  document_id: string;
  entry_type: 'OPENING_BALANCE' | 'PURCHASE_BILL' | 'PAYMENT_MADE' | 'DEBIT_NOTE' | 'CREDIT_NOTE' | 'ADJUSTMENT';
  direction: 'DEBIT' | 'CREDIT';
  amount_paise: string;
  running_balance_paise: string;
  reference_type: string | null;
  reference_id: number | null;
  entry_date: string;
  note: string | null;
  created_at: string;
}

export interface PurchaseInwardItemInput {
  product_id: DocumentId;
  received_qty: string;
  received_unit: string;
  free_qty?: string;
  batch_no?: string;
  mfg_date?: string;
  expiry_date?: string;
  cost_rate_paise: Paise;
  discount_paise?: Paise;
  gst_rate?: number;
  mrp_paise?: Paise;
  selling_price_paise?: Paise;
}

export interface PurchaseInwardRequest {
  client_uuid: UUID;
  supplier_id: DocumentId;
  supplier_invoice_no?: string;
  supplier_invoice_date?: string;
  due_date?: string;
  items: PurchaseInwardItemInput[];
  freight_paise?: Paise;
  other_charges_paise?: Paise;
  payment?: { method: 'CASH' | 'UPI' | 'BANK_TRANSFER' | 'CHEQUE'; amount_paise: Paise; reference?: string };
  note?: string;
}

export interface PurchaseInwardResponse {
  purchase_bill: {
    id: DocumentId;
    grn_no: string;
    status: string;
    subtotal_paise: Paise;
    tax_paise: Paise;
    freight_paise: Paise;
    total_paise: Paise;
    paid_paise: Paise;
    payment_status: string;
    business_date: string;
  };
  batches: Array<{
    batch_id: DocumentId;
    product_id: DocumentId;
    batch_no: string;
    expiry_date?: string;
    qty_in_base: string;
    cost_per_base_paise: Paise;
    landed_cost_per_base_paise: Paise;
    was_existing_batch: boolean;
  }>;
  supplier: { id: DocumentId; balance_before_paise: Paise; balance_after_paise: Paise };
}

export type B2bOrderStatus = 'BOOKED' | 'DISPATCHED' | 'DELIVERED' | 'CANCELLED';
export type FreightTerms = 'PAID_BY_STORE' | 'TO_PAY_BY_CUSTOMER';

export interface B2bOrderLite {
  id: DocumentId;
  status: B2bOrderStatus;
  route?: string;
  vehicle_no?: string;
  transporter?: string;
  driver_name?: string;
  freight_paise?: Paise;
  freight_terms?: FreightTerms;
  challan_no?: string;
  invoice_no?: string;
  total_paise: Paise;
  booked_at: string;
  business_date: string;
  customer_name?: string;
}

export interface BookB2bOrderItemInput {
  product_id: DocumentId;
  entered_qty: string;
  entered_unit: string;
  unit_price_paise?: Paise;
}

export interface BookB2bOrderRequest {
  client_uuid: UUID;
  customer_id: DocumentId;
  route?: string;
  vehicle_no?: string;
  items: BookB2bOrderItemInput[];
  note?: string;
}

export interface CustomerCreditInfo {
  credit_limit_enabled: boolean;
  credit_limit_paise: Paise;
  balance_before_paise: Paise;
  balance_after_paise: Paise;
  headroom_paise: Paise | null;
  would_exceed_limit: boolean;
}

export interface BookB2bOrderResult {
  order: { document_id: DocumentId; total_paise: Paise; status: string; invoice_no?: string };
  items: unknown[];
  customer_credit: CustomerCreditInfo;
  replay: boolean;
}

export interface LoadingSheetLine {
  product_id: DocumentId;
  product_name: string;
  base_unit: string;
  total_qty_base: string;
  packing_unit: string;
  packing_qty_display: string;
}

export interface LoadingSheetResponse {
  order_count: number;
  order_ids: DocumentId[];
  lines: LoadingSheetLine[];
}

export interface DispatchOrdersOptions {
  vehicle_no?: string;
  transporter?: string;
  driver_name?: string;
  freight_paise?: number;
  freight_terms?: FreightTerms;
}

export interface DispatchResponse {
  challan_no: string;
  order_ids: DocumentId[];
  dispatched_at: string;
  vehicle_no: string | null;
  transporter: string | null;
  driver_name: string | null;
  freight_paise: number;
  freight_terms: FreightTerms | null;
}
