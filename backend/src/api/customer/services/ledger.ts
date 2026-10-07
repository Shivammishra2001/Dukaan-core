import { randomUUID } from 'node:crypto';
import type { Core } from '@strapi/strapi';
import type { Knex } from 'knex';
import { isPostgres } from '../../../services/sql-dialect';

declare const strapi: Core.Strapi;

/**
 * DATABASE_SCHEMA.md §6.2 + REQUIREMENTS.md §4.1 (Rules LED-1/2/3).
 *
 * customer_ledger_entries is a custom, non-Strapi table (see
 * database/migrations/0008_customer_ledger_entries_table.js and §9.1) — it
 * is read and written exclusively through this service via
 * `strapi.db.connection` (Knex), never through the Content API.
 *
 * Rule LED-1 requires two concurrent credit posts against the same customer
 * to serialise. The spec's primary approach (`SELECT ... FOR UPDATE LIMIT 1`
 * on the latest row) cannot lock anything when the customer has zero rows
 * yet, so this uses the documented alternative instead:
 * `pg_advisory_xact_lock(hashtext('cust:' || customer_id))`, which serialises
 * unconditionally, including the very first entry for a customer.
 */

export type LedgerEntryType =
  | 'OPENING_BALANCE'
  | 'SALE_CREDIT'
  | 'PAYMENT_RECEIVED'
  | 'CREDIT_NOTE'
  | 'DEBIT_NOTE'
  | 'WRITE_OFF'
  | 'ADJUSTMENT';

export type LedgerDirection = 'DEBIT' | 'CREDIT';

export type LedgerReferenceType = 'ORDER' | 'CUSTOMER_PAYMENT' | 'ADJUSTMENT' | 'SYSTEM';

export interface PostLedgerEntryInput {
  storeId: number;
  customerId: number;
  entryType: LedgerEntryType;
  direction: LedgerDirection;
  amountPaise: number;
  entryDate: string; // 'YYYY-MM-DD'
  referenceType?: LedgerReferenceType;
  referenceId?: number;
  note?: string;
  createdById?: number;
  approvedById?: number;
}

export interface LedgerEntryRow {
  id: number;
  document_id: string;
  store_id: number;
  customer_id: number;
  entry_type: LedgerEntryType;
  direction: LedgerDirection;
  amount_paise: string; // BIGINT comes back as string from node-postgres
  running_balance_paise: string;
  reference_type: LedgerReferenceType | null;
  reference_id: number | null;
  entry_date: string;
  note: string | null;
  created_by_id: number | null;
  approved_by_id: number | null;
  created_at: string;
}

/**
 * Posts one immutable ledger row and updates the customer's cached balance
 * mirror in the same transaction (Rule LED-2). Must run inside a Knex
 * transaction so the advisory lock's scope matches the write's scope
 * (`pg_advisory_xact_lock` releases automatically at transaction end).
 */
export async function postEntry(trx: Knex.Transaction, input: PostLedgerEntryInput): Promise<LedgerEntryRow> {
  if (input.amountPaise <= 0) {
    throw new Error('ERR_LEDGER_AMOUNT_INVALID: amount_paise must be > 0');
  }

  // pg_advisory_xact_lock has no SQLite equivalent; skipped on the dev-only
  // SQLite path (single-connection sequential testing doesn't need it —
  // production always runs Postgres, where the lock is real).
  if (isPostgres(trx)) {
    await trx.raw('SELECT pg_advisory_xact_lock(hashtext(?))', [`cust:${input.customerId}`]);
  }

  const latest = await trx('customer_ledger_entries')
    .where({ customer_id: input.customerId })
    .orderBy('id', 'desc')
    .first('running_balance_paise');

  const priorBalance = latest ? Number(latest.running_balance_paise) : 0;
  const signedDelta = input.direction === 'DEBIT' ? input.amountPaise : -input.amountPaise;
  const runningBalance = priorBalance + signedDelta;

  const [row] = await trx('customer_ledger_entries')
    .insert({
      document_id: randomUUID(),
      store_id: input.storeId,
      customer_id: input.customerId,
      entry_type: input.entryType,
      direction: input.direction,
      amount_paise: input.amountPaise,
      running_balance_paise: runningBalance,
      reference_type: input.referenceType ?? null,
      reference_id: input.referenceId ?? null,
      entry_date: input.entryDate,
      note: input.note ?? null,
      created_by_id: input.createdById ?? null,
      approved_by_id: input.approvedById ?? null,
    })
    .returning('*');

  await trx('customers')
    .where({ id: input.customerId })
    .update({ current_balance_paise: runningBalance, last_txn_at: trx.fn.now() });

  return row as LedgerEntryRow;
}

/** Convenience wrapper for callers that don't already hold a transaction. */
export async function postEntryStandalone(input: PostLedgerEntryInput): Promise<LedgerEntryRow> {
  return strapi.db.connection.transaction((trx) => postEntry(trx, input));
}

export async function listEntries(
  customerId: number,
  opts: { limit?: number; beforeId?: number } = {}
): Promise<LedgerEntryRow[]> {
  const query = strapi.db
    .connection('customer_ledger_entries')
    .where({ customer_id: customerId })
    .orderBy('id', 'desc')
    .limit(opts.limit ?? 50);
  if (opts.beforeId) {
    query.andWhere('id', '<', opts.beforeId);
  }
  return query;
}

export async function getBalance(customerId: number): Promise<number> {
  const latest = await strapi.db
    .connection('customer_ledger_entries')
    .where({ customer_id: customerId })
    .orderBy('id', 'desc')
    .first('running_balance_paise');
  return latest ? Number(latest.running_balance_paise) : 0;
}

export default { postEntry, postEntryStandalone, listEntries, getBalance };
