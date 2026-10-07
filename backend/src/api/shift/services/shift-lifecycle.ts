import type { Core } from '@strapi/strapi';
import type { Knex } from 'knex';
import { AppError, isUniqueViolation } from '../../../services/errors';
import { strapiRowStamps } from '../../../services/strapi-row';
import { writeAuditLog } from '../../../services/audit';

declare const strapi: Core.Strapi;

/**
 * REQUIREMENTS.md §5 (Cash Drawer & Shift Reconciliation) + DATABASE_SCHEMA.md
 * §5.1/§5.2 + API_CONTRACTS.md §6. Same pattern as checkout.service.ts:
 * Knex transactions, not the Document Service (Rule BE-2), so SH-1/SH-2's
 * partial unique indexes are the real concurrency guard.
 *
 * Known gap: Rule SH-4 ("MUST NOT close while the device has unsynced bills
 * or parked carts") isn't enforced here — that requires the outbox/exception
 * queue tables, which live client-side in this milestone (frontend Dexie),
 * not server-side. A real deployment would need the device to report its
 * outbox depth before close.
 */

async function resolveStore(trx: Knex.Transaction, storeDocumentId: string) {
  const store = await trx('stores').where({ document_id: storeDocumentId }).first();
  if (!store) throw new AppError('ERR_STORE_MISMATCH', 403, `Unknown store ${storeDocumentId}`);
  return store;
}

async function resolveCounterStrict(trx: Knex.Transaction, storeId: number, counterDocumentId: string) {
  const counter = await trx('counters').where({ document_id: counterDocumentId, store_id: storeId }).first();
  if (!counter) throw new AppError('ERR_STORE_MISMATCH', 403, `Counter ${counterDocumentId} does not belong to this store`);
  return counter;
}

/** No auth system yet — same "System Cashier" fallback as checkout.service.ts. */
async function resolveCashier(trx: Knex.Transaction, tenantId: number, cashierDocumentId?: string) {
  if (cashierDocumentId) {
    const user = await trx('app_users').where({ document_id: cashierDocumentId, tenant_id: tenantId }).first();
    if (!user) throw new AppError('ERR_STORE_MISMATCH', 403, `User ${cashierDocumentId} does not belong to this tenant`);
    return user;
  }
  const existing = await trx('app_users').where({ tenant_id: tenantId, full_name: 'System Cashier' }).first();
  if (existing) return existing;
  const [created] = await trx('app_users')
    .insert({ ...strapiRowStamps(), tenant_id: tenantId, full_name: 'System Cashier', is_active: true })
    .returning('*');
  return created;
}

/**
 * The OPEN shift the POS should resume for this cashier (Rule SH-2: at most
 * one per user per store). Shifts opened before the BFF forwarded
 * X-Cashier-Id were all attributed to the placeholder "System Cashier"; the
 * signed-in user picks one of those up rather than leaving its counter
 * blocked by an open shift nobody can see.
 */
export async function findActiveShift(knex: Knex, store: { id: number; tenant_id: number }, cashierDocumentId?: string) {
  const openShifts = () => knex('shifts').where({ store_id: store.id, status: 'OPEN' }).orderBy('opened_at', 'desc');
  if (cashierDocumentId) {
    const user = await knex('app_users').where({ document_id: cashierDocumentId, tenant_id: store.tenant_id }).first();
    if (user) {
      const own = await openShifts().andWhere({ cashier_id: user.id }).first();
      if (own) return own;
    }
  }
  const placeholder = await knex('app_users').where({ tenant_id: store.tenant_id, full_name: 'System Cashier' }).first();
  if (!placeholder) return null;
  return (await openShifts().andWhere({ cashier_id: placeholder.id }).first()) ?? null;
}

export async function getActiveShift(storeDocumentId: string, cashierDocumentId?: string) {
  const knex = strapi.db.connection;
  const store = await knex('stores').where({ document_id: storeDocumentId }).first();
  if (!store) throw new AppError('ERR_STORE_MISMATCH', 403, `Unknown store ${storeDocumentId}`);
  const shift = await findActiveShift(knex, store, cashierDocumentId);
  if (!shift) return null;
  const [counter, cashier] = await Promise.all([
    knex('counters').where({ id: shift.counter_id, store_id: store.id }).first(),
    knex('app_users').where({ id: shift.cashier_id }).first(),
  ]);
  // A shift whose counter isn't in this store is never resumable here.
  if (!counter || !cashier) return null;
  return { shift, counter, cashier };
}

async function findShiftOrThrow(trx: Knex.Transaction, storeId: number, shiftDocumentId: string) {
  const shift = await trx('shifts').where({ document_id: shiftDocumentId, store_id: storeId }).first();
  if (!shift) throw new AppError('ERR_NOT_FOUND', 404, `Shift ${shiftDocumentId} not found`);
  return shift;
}

// ---------------------------------------------------------------------------
// Open
// ---------------------------------------------------------------------------

export interface OpenShiftInput {
  storeDocumentId: string;
  counterDocumentId: string;
  cashierDocumentId?: string;
  openingFloatPaise: number;
}

export async function openShift(input: OpenShiftInput) {
  if (!Number.isInteger(input.openingFloatPaise) || input.openingFloatPaise < 0) {
    throw new AppError('ERR_VALIDATION', 400, 'opening_float_paise must be a non-negative integer');
  }

  return strapi.db.connection.transaction(async (trx: Knex.Transaction) => {
    const store = await resolveStore(trx, input.storeDocumentId);
    const counter = await resolveCounterStrict(trx, store.id, input.counterDocumentId);
    const cashier = await resolveCashier(trx, store.tenant_id, input.cashierDocumentId);

    // Rules SH-1/SH-2 are partial unique indexes on Postgres (migration 0017),
    // which SQLite dev databases skip — check explicitly so they hold on both.
    // The indexes remain the real guard against concurrent opens on Postgres.
    const liveStatuses = ['OPEN', 'PENDING_COUNT'];
    if (await trx('shifts').where({ counter_id: counter.id }).whereIn('status', liveStatuses).first()) {
      throw new AppError('ERR_SHIFT_ALREADY_OPEN_COUNTER', 422, 'This counter already has an open shift');
    }
    if (await trx('shifts').where({ store_id: store.id, cashier_id: cashier.id }).whereIn('status', liveStatuses).first()) {
      throw new AppError('ERR_SHIFT_ALREADY_OPEN_USER', 422, 'This cashier already has an open shift on another counter');
    }

    try {
      const [shift] = await trx('shifts')
        .insert({
          ...strapiRowStamps(),
          store_id: store.id,
          counter_id: counter.id,
          cashier_id: cashier.id,
          status: 'OPEN',
          opened_at: new Date(),
          opening_float_paise: input.openingFloatPaise,
          // This raw Knex insert bypasses the Document Service, so schema.json's
          // `default: "0"` on these columns never applies — leaving them SQL NULL
          // otherwise. Every later `column + ?` increment (checkout's tender
          // totals, cash-movement's cash_in/cash_out) then computes NULL forever,
          // silently discarding every sale for the life of the shift.
          cash_sales_paise: '0',
          card_sales_paise: '0',
          upi_sales_paise: '0',
          wallet_sales_paise: '0',
          credit_sales_paise: '0',
          cash_collections_paise: '0',
          cash_in_paise: '0',
          cash_out_paise: '0',
          cash_refunds_paise: '0',
          bill_count: 0,
          void_count: 0,
          return_count: 0,
          discount_total_paise: '0',
        })
        .returning('*');
      return { shift, store, counter, cashier };
    } catch (err) {
      // Rule SH-1
      if (isUniqueViolation(err, 'uq_open_shift_per_counter')) {
        throw new AppError('ERR_SHIFT_ALREADY_OPEN_COUNTER', 422, 'This counter already has an open shift');
      }
      // Rule SH-2
      if (isUniqueViolation(err, 'uq_open_shift_per_user')) {
        throw new AppError('ERR_SHIFT_ALREADY_OPEN_USER', 422, 'This cashier already has an open shift on another counter');
      }
      throw err;
    }
  });
}

// ---------------------------------------------------------------------------
// Expected cash (REQUIREMENTS.md §5.2)
// ---------------------------------------------------------------------------

export function computeExpectedCashPaise(shift: Record<string, any>): number {
  return (
    Number(shift.opening_float_paise) +
    Number(shift.cash_sales_paise) +
    Number(shift.cash_collections_paise) +
    Number(shift.cash_in_paise) -
    Number(shift.cash_refunds_paise) -
    Number(shift.cash_out_paise)
  );
}

export async function getExpectedCash(storeDocumentId: string, shiftDocumentId: string) {
  const knex = strapi.db.connection;
  const store = await knex('stores').where({ document_id: storeDocumentId }).first();
  if (!store) throw new AppError('ERR_STORE_MISMATCH', 403, 'Unknown store');
  const shift = await knex('shifts').where({ document_id: shiftDocumentId, store_id: store.id }).first();
  if (!shift) throw new AppError('ERR_NOT_FOUND', 404, 'Shift not found');
  return { shift, expected: computeExpectedCashPaise(shift) };
}

// ---------------------------------------------------------------------------
// Denomination count (REQUIREMENTS.md §5.3)
// ---------------------------------------------------------------------------

const DENOMINATION_VALUES_RUPEES: Record<string, number> = {
  d2000: 2000,
  d500: 500,
  d200: 200,
  d100: 100,
  d50: 50,
  d20: 20,
  d10: 10,
  d5: 5,
  d2: 2,
  d1: 1,
};

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

/**
 * Milestone 5 hardening: a negative denomination count (or coin total) is
 * nonsensical and would silently understate `actual_cash_paise`, corrupting
 * the variance calculation — the client already clamps to >= 0, but the
 * server is authoritative, so it's validated again here.
 */
export function actualCashFromDenomination(count: DenominationCount): number {
  let totalPaise = 0;
  for (const [key, rupees] of Object.entries(DENOMINATION_VALUES_RUPEES)) {
    const n = count[key as keyof DenominationCount] ?? 0;
    if (!Number.isInteger(n) || n < 0) {
      throw new AppError('ERR_VALIDATION', 400, `denomination_count.${key} must be a non-negative integer`);
    }
    totalPaise += n * rupees * 100;
  }
  const coins = count.coins_paise ?? 0;
  if (!Number.isInteger(coins) || coins < 0) {
    throw new AppError('ERR_VALIDATION', 400, 'denomination_count.coins_paise must be a non-negative integer');
  }
  return totalPaise + coins;
}

// ---------------------------------------------------------------------------
// Close (REQUIREMENTS.md §5.4)
// ---------------------------------------------------------------------------

const DEFAULT_VARIANCE_TOLERANCE_PAISE = 1000; // ₹10
const DEFAULT_VARIANCE_ESCALATION_PAISE = 50_000; // ₹500

export type VarianceClassification = 'NONE' | 'WITHIN_TOLERANCE' | 'REQUIRES_REASON' | 'ESCALATED';

export interface CloseShiftInput {
  storeDocumentId: string;
  shiftDocumentId: string;
  denominationCount: DenominationCount;
  varianceReasonCode?: string;
  varianceReasonText?: string;
  hasApproval: boolean;
  approverDocumentId?: string;
  closedByDocumentId?: string;
  /** Milestone 5 / Rule SH-4: the client couldn't drain its outbox (permanent connectivity loss) and a supervisor is overriding the close anyway. */
  hasPendingOfflineSync?: boolean;
}

export async function closeShift(input: CloseShiftInput) {
  return strapi.db.connection.transaction(async (trx: Knex.Transaction) => {
    const store = await resolveStore(trx, input.storeDocumentId);
    const shift = await findShiftOrThrow(trx, store.id, input.shiftDocumentId);
    if (shift.status === 'CLOSED') throw new AppError('ERR_SHIFT_ALREADY_CLOSED', 422, 'Shift is already closed');

    const config = typeof store.config === 'string' ? JSON.parse(store.config) : (store.config ?? {});
    const tolerance = config?.shift?.variance_tolerance_paise ?? DEFAULT_VARIANCE_TOLERANCE_PAISE;
    const escalation = config?.shift?.variance_escalation_paise ?? DEFAULT_VARIANCE_ESCALATION_PAISE;

    const expected = computeExpectedCashPaise(shift);
    const actual = actualCashFromDenomination(input.denominationCount);
    const variance = actual - expected;
    const absVariance = Math.abs(variance);

    let classification: VarianceClassification;
    if (variance === 0) classification = 'NONE';
    else if (absVariance <= tolerance) classification = 'WITHIN_TOLERANCE';
    else if (absVariance <= escalation) classification = 'REQUIRES_REASON';
    else classification = 'ESCALATED';

    if (classification === 'REQUIRES_REASON' || classification === 'ESCALATED') {
      if (!input.varianceReasonCode) {
        throw new AppError('ERR_VALIDATION', 400, 'variance_reason_code is required when variance exceeds tolerance');
      }
      if (!input.hasApproval) {
        // Rule SH-6/SH-4-adjacent: mirrors checkout's approval-token gate.
        throw new AppError('ERR_APPROVAL_REQUIRED', 422, 'Supervisor approval is required to close with this variance', {
          details: { variance_paise: variance, classification },
          resolutions: [{ action: 'APPROVE_OVERRIDE', label: 'Supervisor approval', requires_permission: 'shift.close_own' }],
        });
      }
    }

    // Rule SH-4: closing with a known-nonempty client outbox is itself an
    // override — same ALLOW_WITH_APPROVAL pattern as a variance breach.
    if (input.hasPendingOfflineSync && !input.hasApproval) {
      throw new AppError('ERR_APPROVAL_REQUIRED', 422, 'Supervisor approval is required to close with unsynced offline bills pending', {
        resolutions: [{ action: 'APPROVE_OVERRIDE', label: 'Supervisor approval', requires_permission: 'shift.close_own' }],
      });
    }

    const status = classification === 'ESCALATED' ? 'UNDER_REVIEW' : 'CLOSED';
    const now = new Date();
    const closedBy = await resolveCashier(trx, store.tenant_id, input.closedByDocumentId);
    const approver = input.hasApproval ? await resolveCashier(trx, store.tenant_id, input.approverDocumentId) : null;

    const [updated] = await trx('shifts')
      .where({ id: shift.id })
      .update({
        status,
        closed_at: now,
        expected_cash_paise: expected,
        actual_cash_paise: actual,
        variance_paise: variance,
        denomination_count: JSON.stringify(input.denominationCount),
        variance_reason_code: input.varianceReasonCode ?? null,
        variance_reason_text: input.varianceReasonText ?? null,
        closed_by_id: closedBy.id,
        approved_by_id: approver?.id ?? null,
        updated_at: now,
      })
      .returning('*');

    if (classification !== 'NONE') {
      // Rule SH-6: variance is audited, never silently absorbed.
      await writeAuditLog(trx, {
        store_id: store.id,
        actor_user_id: closedBy.id,
        approver_user_id: approver?.id,
        action: 'SHIFT_VARIANCE',
        entity_type: 'shift',
        entity_id: shift.id,
        after_json: { variance_paise: variance, classification, expected_cash_paise: expected, actual_cash_paise: actual },
        reason_code: input.varianceReasonCode,
        reason_text: input.varianceReasonText,
      });
    }

    if (input.hasPendingOfflineSync) {
      await writeAuditLog(trx, {
        store_id: store.id,
        actor_user_id: closedBy.id,
        approver_user_id: approver?.id,
        action: 'SHIFT_CLOSED_WITH_PENDING_SYNC',
        entity_type: 'shift',
        entity_id: shift.id,
        reason_text: 'Shift closed with unsynced offline bills still queued on the device',
      });
    }

    return { shift: updated, expected, actual, variance, classification, store };
  });
}

// ---------------------------------------------------------------------------
// Cash movement (REQUIREMENTS.md §5.2's cash_in/cash_out terms)
// ---------------------------------------------------------------------------

const CASH_MOVEMENT_REASONS = [
  'FLOAT_TOPUP',
  'FLOAT_ADD',
  'BANK_DROP',
  'PETTY_EXPENSE',
  'SUPPLIER_PAYMENT',
  'OWNER_DRAW',
  'REFUND',
  'OTHER',
];

export interface CashMovementInput {
  storeDocumentId: string;
  shiftDocumentId: string;
  direction: 'IN' | 'OUT';
  amountPaise: number;
  reasonCode: string;
  note?: string;
  createdByDocumentId?: string;
}

export async function recordCashMovement(input: CashMovementInput) {
  if (!Number.isInteger(input.amountPaise) || input.amountPaise <= 0) {
    throw new AppError('ERR_VALIDATION', 400, 'amount_paise must be a positive integer');
  }
  if (!CASH_MOVEMENT_REASONS.includes(input.reasonCode)) {
    throw new AppError('ERR_VALIDATION', 400, `reason_code must be one of ${CASH_MOVEMENT_REASONS.join(', ')}`);
  }

  return strapi.db.connection.transaction(async (trx: Knex.Transaction) => {
    const store = await resolveStore(trx, input.storeDocumentId);
    const shift = await findShiftOrThrow(trx, store.id, input.shiftDocumentId);
    if (shift.status !== 'OPEN') throw new AppError('ERR_SHIFT_NOT_OPEN', 422, 'Shift is not open');

    const createdBy = await resolveCashier(trx, store.tenant_id, input.createdByDocumentId);

    await trx('cash_movements').insert({
      store_id: store.id,
      shift_id: shift.id,
      direction: input.direction,
      amount_paise: input.amountPaise,
      reason_code: input.reasonCode,
      note: input.note ?? null,
      created_by_id: createdBy.id,
      occurred_at: new Date(),
    });

    const column = input.direction === 'IN' ? 'cash_in_paise' : 'cash_out_paise';
    const [updated] = await trx('shifts').where({ id: shift.id }).increment(column, input.amountPaise).returning('*');
    return updated;
  });
}

// ---------------------------------------------------------------------------
// Force close
// ---------------------------------------------------------------------------

export interface ForceCloseInput {
  storeDocumentId: string;
  shiftDocumentId: string;
  reasonText: string;
  approverDocumentId?: string;
}

export async function forceCloseShift(input: ForceCloseInput) {
  if (!input.reasonText?.trim()) throw new AppError('ERR_VALIDATION', 400, 'reason_text is required for a force-close');

  return strapi.db.connection.transaction(async (trx: Knex.Transaction) => {
    const store = await resolveStore(trx, input.storeDocumentId);
    const shift = await findShiftOrThrow(trx, store.id, input.shiftDocumentId);
    if (shift.status === 'CLOSED') throw new AppError('ERR_SHIFT_ALREADY_CLOSED', 422, 'Shift is already closed');

    const expected = computeExpectedCashPaise(shift);
    const now = new Date();
    const approver = await resolveCashier(trx, store.tenant_id, input.approverDocumentId);

    const [updated] = await trx('shifts')
      .where({ id: shift.id })
      .update({
        status: 'CLOSED',
        closed_at: now,
        expected_cash_paise: expected,
        actual_cash_paise: expected, // no physical count on a force-close
        variance_paise: 0,
        force_closed: true,
        variance_reason_text: input.reasonText,
        closed_by_id: approver.id,
        approved_by_id: approver.id,
        updated_at: now,
      })
      .returning('*');

    await writeAuditLog(trx, {
      store_id: store.id,
      actor_user_id: approver.id,
      approver_user_id: approver.id,
      action: 'SHIFT_FORCE_CLOSE',
      entity_type: 'shift',
      entity_id: shift.id,
      reason_text: input.reasonText,
    });

    return updated;
  });
}
