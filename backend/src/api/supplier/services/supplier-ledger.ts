import { randomUUID } from 'node:crypto';
import type { Core } from '@strapi/strapi';
import type { Knex } from 'knex';
import { isPostgres } from '../../../services/sql-dialect';

declare const strapi: Core.Strapi;

/**
 * DATABASE_SCHEMA.md §7.4. Mirrors src/api/customer/services/ledger.ts's
 * structure exactly, but the sign convention is the opposite one on
 * purpose: for a supplier, `direction: 'CREDIT'` means "we owe more"
 * (we received goods on credit), and `'DEBIT'` means "we owe less" (we
 * paid them) — accounts-payable convention, the mirror image of the
 * customer ledger's accounts-receivable convention (there DEBIT = they owe
 * more). Not extracted into a shared generic module: the sign flip makes a
 * "generic ledger" abstraction more confusing than two small, explicit
 * copies — same judgement call as duplicating checkout's FEFO code for
 * b2b-dispatch rather than forcing a shared abstraction under time pressure.
 */

export type SupplierLedgerEntryType = 'OPENING_BALANCE' | 'PURCHASE_BILL' | 'PAYMENT_MADE' | 'DEBIT_NOTE' | 'CREDIT_NOTE' | 'ADJUSTMENT';
export type SupplierLedgerDirection = 'DEBIT' | 'CREDIT';

export interface PostSupplierLedgerEntryInput {
  storeId: number;
  supplierId: number;
  entryType: SupplierLedgerEntryType;
  direction: SupplierLedgerDirection;
  amountPaise: number;
  entryDate: string;
  referenceType?: string;
  referenceId?: number;
  note?: string;
  createdById?: number;
}

export interface SupplierLedgerEntryRow {
  id: number;
  document_id: string;
  store_id: number;
  supplier_id: number;
  entry_type: SupplierLedgerEntryType;
  direction: SupplierLedgerDirection;
  amount_paise: string;
  running_balance_paise: string;
  reference_type: string | null;
  reference_id: number | null;
  entry_date: string;
  note: string | null;
  created_by_id: number | null;
  created_at: string;
}

/** Must run inside a transaction already holding (or about to take) the supplier lock — see 10.1's fixed lock order (suppliers last). */
export async function postSupplierEntry(trx: Knex.Transaction, input: PostSupplierLedgerEntryInput): Promise<SupplierLedgerEntryRow> {
  if (input.amountPaise <= 0) {
    throw new Error('ERR_LEDGER_AMOUNT_INVALID: amount_paise must be > 0');
  }

  // Rule LED-1's advisory-lock equivalent, scoped to this supplier — serialises
  // concurrent postings the same way src/api/customer/services/ledger.ts does.
  // No SQLite equivalent; skipped on the dev-only SQLite path (see that
  // file's comment for why this is safe there).
  if (isPostgres(trx)) {
    await trx.raw('SELECT pg_advisory_xact_lock(hashtext(?))', [`supplier:${input.supplierId}`]);
  }

  const latest = await trx('supplier_ledger_entries')
    .where({ supplier_id: input.supplierId })
    .orderBy('id', 'desc')
    .first('running_balance_paise');

  const priorBalance = latest ? Number(latest.running_balance_paise) : 0;
  const signedDelta = input.direction === 'CREDIT' ? input.amountPaise : -input.amountPaise;
  const runningBalance = priorBalance + signedDelta;

  const [row] = await trx('supplier_ledger_entries')
    .insert({
      document_id: randomUUID(),
      store_id: input.storeId,
      supplier_id: input.supplierId,
      entry_type: input.entryType,
      direction: input.direction,
      amount_paise: input.amountPaise,
      running_balance_paise: runningBalance,
      reference_type: input.referenceType ?? null,
      reference_id: input.referenceId ?? null,
      entry_date: input.entryDate,
      note: input.note ?? null,
      created_by_id: input.createdById ?? null,
    })
    .returning('*');

  await trx('suppliers').where({ id: input.supplierId }).update({ current_balance_paise: runningBalance });

  return row as SupplierLedgerEntryRow;
}

export async function postSupplierEntryStandalone(input: PostSupplierLedgerEntryInput): Promise<SupplierLedgerEntryRow> {
  return strapi.db.connection.transaction((trx) => postSupplierEntry(trx, input));
}

export async function listSupplierEntries(supplierId: number, opts: { limit?: number; beforeId?: number } = {}): Promise<SupplierLedgerEntryRow[]> {
  const query = strapi.db
    .connection('supplier_ledger_entries')
    .where({ supplier_id: supplierId })
    .orderBy('id', 'desc')
    .limit(opts.limit ?? 50);
  if (opts.beforeId) query.andWhere('id', '<', opts.beforeId);
  return query;
}

export async function getSupplierBalance(supplierId: number): Promise<number> {
  const latest = await strapi.db.connection('supplier_ledger_entries').where({ supplier_id: supplierId }).orderBy('id', 'desc').first('running_balance_paise');
  return latest ? Number(latest.running_balance_paise) : 0;
}
