/** API_CONTRACTS.md §6 — mirrors backend/src/api/shift/controllers/shift-lifecycle.ts response shapes. */

export type ShiftStatus = 'OPEN' | 'PENDING_COUNT' | 'CLOSED' | 'UNDER_REVIEW';

export interface OpenShiftRequest {
  client_uuid: string;
  counter_id: string;
  opening_float_paise: number;
  device_id: string;
}

export interface ShiftSummary {
  id: string;
  counter: { id: string; code: string; name: string };
  user: { id: string; full_name: string };
  status: ShiftStatus;
  opened_at: string;
  closed_at?: string;
  opening_float_paise: number;
  bill_count: number;
  tender_totals: Record<string, number>;
}

export interface ExpectedCashResponse {
  shift_id: string;
  opening_float_paise: number;
  cash_sales_paise: number;
  cash_collections_paise: number;
  cash_in_paise: number;
  cash_out_paise: number;
  cash_refunds_paise: number;
  expected_cash_paise: number;
  non_cash: { card_paise: number; upi_paise: number; wallet_paise: number; credit_paise: number };
  blockers: Array<{ code: string; count: number; message: string }>;
}

export interface DenominationCount {
  d2000?: number;
  d500?: number;
  d200?: number;
  d100?: number;
  d50?: number;
  d20?: number;
  d10?: number;
  d5?: number;
  d2?: number;
  d1?: number;
  coins_paise?: number;
}

export interface CloseShiftRequest {
  denomination_count: DenominationCount;
  variance_reason_code?: 'MISCOUNT' | 'CHANGE_ERROR' | 'UNRECORDED_PAYOUT' | 'THEFT_SUSPECTED' | 'OTHER';
  variance_reason_text?: string;
  approval_token?: string;
  /** Milestone 5 / Rule SH-4: set when a supervisor force-closes with unsynced offline bills still queued. */
  has_pending_offline_sync?: boolean;
}

export type VarianceClassification = 'NONE' | 'WITHIN_TOLERANCE' | 'REQUIRES_REASON' | 'ESCALATED';

export interface ZReport {
  shift_id: string;
  store_name: string;
  opened_at: string;
  closed_at: string;
  tender_totals: Record<string, number>;
  bill_count: number;
  avg_bill_paise: number;
  discount_total_paise: number;
  void_count: number;
  return_count: number;
  expected_cash_paise: number;
  actual_cash_paise: number;
  variance_paise: number;
}

export interface CloseShiftResponse {
  shift: ShiftSummary;
  expected_cash_paise: number;
  actual_cash_paise: number;
  variance_paise: number;
  variance_classification: VarianceClassification;
  z_report: ZReport;
}

export type CashMovementReasonCode =
  | 'FLOAT_TOPUP'
  | 'FLOAT_ADD'
  | 'BANK_DROP'
  | 'PETTY_EXPENSE'
  | 'SUPPLIER_PAYMENT'
  | 'OWNER_DRAW'
  | 'REFUND'
  | 'OTHER';

export interface CashMovementRequest {
  shift_id: string;
  direction: 'IN' | 'OUT';
  amount_paise: number;
  reason_code: CashMovementReasonCode;
  note?: string;
}

export interface CashMovementResponse {
  shift_id: string;
  cash_in_paise: number;
  cash_out_paise: number;
}

/** Reports & Shift History row — Strapi's core `GET /api/shifts` find (backend/src/api/shift/routes/shift.ts only exposes find/findOne), not the lifecycle DTOs above. */
export interface ShiftHistoryRow {
  id: string;
  counter: { id: string; code: string; name: string } | null;
  cashier: { id: string; full_name: string } | null;
  status: ShiftStatus;
  opened_at: string;
  closed_at: string | null;
  opening_float_paise: number;
  cash_sales_paise: number;
  cash_in_paise: number;
  cash_out_paise: number;
  actual_cash_paise: number | null;
  expected_cash_paise: number | null;
  variance_paise: number | null;
  bill_count: number;
}
