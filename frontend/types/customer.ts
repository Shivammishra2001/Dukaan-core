import type { DocumentId, Paise } from './checkout';

/** Mirrors backend/src/api/customer's schema.json + services/ledger.ts response shapes. */

export interface CustomerLite {
  id: DocumentId;
  name: string;
  name_local?: string;
  phone_last4?: string;
  current_balance_paise: Paise;
  credit_limit_enabled: boolean;
  credit_limit_paise: Paise;
  is_active: boolean;
  last_txn_at?: string;
}

export type CustomerLedgerEntryType =
  | 'OPENING_BALANCE'
  | 'SALE_CREDIT'
  | 'PAYMENT_RECEIVED'
  | 'CREDIT_NOTE'
  | 'DEBIT_NOTE'
  | 'WRITE_OFF'
  | 'ADJUSTMENT';

export interface CustomerLedgerEntry {
  id: number;
  document_id: string;
  entry_type: CustomerLedgerEntryType;
  direction: 'DEBIT' | 'CREDIT';
  amount_paise: string;
  running_balance_paise: string;
  reference_type: string | null;
  reference_id: number | null;
  entry_date: string;
  note: string | null;
  created_at: string;
}

export type PaymentMethod = 'CASH' | 'UPI' | 'CARD' | 'BANK_TRANSFER' | 'CHEQUE';

export interface RecordPaymentRequest {
  amount_paise: number;
  method: PaymentMethod;
  note?: string;
  entry_date?: string;
}
