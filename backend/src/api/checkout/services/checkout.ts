import { createHash } from 'node:crypto';
import Decimal from 'decimal.js';
import type { Core } from '@strapi/strapi';
import type { Knex } from 'knex';
import { CheckoutError, findConversion, toBase, validateEnteredQty, type UnitConversionRow } from '../../../services/units';
import { computeTotals, roundPaise, type PricingLine } from '../../../services/pricing';
import { businessDateIso, financialYear } from '../../../services/business-date';
import { writeAuditLog } from '../../../services/audit';
import { strapiRowStamps } from '../../../services/strapi-row';
import { nowSql, forUpdateSql, rawRows } from '../../../services/sql-dialect';
import { postEntry } from '../../customer/services/ledger';
import { resolveInvoicePrefix } from '../../../services/invoice-prefix';
import { createOrderRequestSchema, type CreateOrderItemInput, type CreateOrderRequest } from './checkout-dto';

declare const strapi: Core.Strapi;

/**
 * SYSTEM_ARCHITECTURE.md §4.1 + API_CONTRACTS.md §2.4 (normative processing
 * contract). This is the single most important transaction in the system —
 * it deliberately bypasses Strapi's Document Service (Rule BE-2 / ADR-04)
 * and runs entirely on `strapi.db.connection.transaction()` (Knex), because
 * the Document Service cannot express multi-row `FOR UPDATE` locking or
 * true cross-table atomicity.
 */

function requestHash(body: unknown): Buffer {
  return createHash('sha256').update(JSON.stringify(body)).digest();
}

// ---------------------------------------------------------------------------
// Context resolution
// ---------------------------------------------------------------------------

async function resolveStore(trx: Knex.Transaction, storeDocumentId: string) {
  const store = await trx('stores').where({ document_id: storeDocumentId }).first();
  if (!store) throw new CheckoutError('ERR_STORE_MISMATCH', 403, `Unknown store ${storeDocumentId}`);
  return store;
}

/** No auth/device-registration flow exists yet — falls back to (and lazily creates) a per-store default. */
async function resolveCounter(trx: Knex.Transaction, storeId: number, counterDocumentId?: string) {
  if (counterDocumentId) {
    const counter = await trx('counters').where({ document_id: counterDocumentId, store_id: storeId }).first();
    if (!counter) throw new CheckoutError('ERR_STORE_MISMATCH', 403, `Counter ${counterDocumentId} does not belong to this store`);
    return counter;
  }
  const existing = await trx('counters').where({ store_id: storeId }).orderBy('id', 'asc').first();
  if (existing) return existing;
  const [created] = await trx('counters')
    .insert({ ...strapiRowStamps(), store_id: storeId, code: 'C1', name: 'Counter 1', is_active: true })
    .returning('*');
  return created;
}

/** Stub for the not-yet-built auth system: falls back to a per-tenant "System Cashier". */
async function resolveCashier(trx: Knex.Transaction, tenantId: number, cashierDocumentId?: string) {
  if (cashierDocumentId) {
    const user = await trx('app_users').where({ document_id: cashierDocumentId, tenant_id: tenantId }).first();
    if (!user) throw new CheckoutError('ERR_STORE_MISMATCH', 403, `User ${cashierDocumentId} does not belong to this tenant`);
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
 * Milestone 4 addition (Rule SH-3: "every order... created while a shift is
 * open MUST carry shift_id"). Purely additive: when `store.config.shift.enabled`
 * is false (the DATABASE_SCHEMA.md §2.3 default), this returns null and
 * checkout proceeds exactly as it did in Milestone 3.
 */
async function resolveShift(trx: Knex.Transaction, storeId: number, shiftEnabled: boolean, shiftDocumentId?: string) {
  if (!shiftDocumentId) {
    if (shiftEnabled) throw new CheckoutError('ERR_NO_OPEN_SHIFT', 422, 'A shift is required by store config and none was provided');
    return null;
  }
  const shift = await trx('shifts').where({ document_id: shiftDocumentId, store_id: storeId }).first();
  if (!shift) throw new CheckoutError('ERR_STORE_MISMATCH', 403, `Shift ${shiftDocumentId} does not belong to this store`);
  if (shift.status !== 'OPEN') throw new CheckoutError('ERR_NO_OPEN_SHIFT', 422, `Shift ${shiftDocumentId} is not open`);
  // The shift row's own store_id matching is not enough on its own: its counter must belong to the same store too.
  const shiftCounter = await trx('counters').where({ id: shift.counter_id, store_id: storeId }).first();
  if (!shiftCounter) throw new CheckoutError('ERR_STORE_MISMATCH', 403, `Shift ${shiftDocumentId} is open on a counter outside this store`);
  return { shift, shiftCounter };
}

async function resolveCustomer(trx: Knex.Transaction, storeId: number, customerDocumentId?: string) {
  if (!customerDocumentId) return null;
  const customer = await trx('customers').where({ document_id: customerDocumentId, store_id: storeId }).first();
  if (!customer) throw new CheckoutError('ERR_STORE_MISMATCH', 403, `Customer ${customerDocumentId} does not belong to this store`);
  return customer;
}

// ---------------------------------------------------------------------------
// Item resolution + pricing (Rule PR-1/PR-2/PR-3; BATCH-tier pricing is not
// implemented — same documented gap as the frontend preview)
// ---------------------------------------------------------------------------

interface ResolvedItem {
  raw: CreateOrderItemInput;
  product: Record<string, any>;
  conversions: UnitConversionRow[];
  qtyBase: Decimal;
  unitPricePaise: number;
  priceSource: 'PRODUCT' | 'UNIT_OVERRIDE' | 'MANUAL';
  lineDiscount: { type: 'FLAT' | 'PCT'; value: number } | null;
}

async function resolveItems(trx: Knex.Transaction, storeId: number, items: CreateOrderItemInput[]): Promise<ResolvedItem[]> {
  const productIds = Array.from(new Set(items.map((i) => i.product_id)));
  const products = await trx('products').whereIn('document_id', productIds).andWhere({ store_id: storeId });
  const productByDocId = new Map(products.map((p) => [p.document_id, p]));

  const numericProductIds = products.map((p) => p.id);
  const allConversions: UnitConversionRow[] = await trx('unit_conversions').whereIn('product_id', numericProductIds);
  const conversionsByProductId = new Map<number, UnitConversionRow[]>();
  for (const c of allConversions) {
    const list = conversionsByProductId.get(c.product_id) ?? [];
    list.push(c);
    conversionsByProductId.set(c.product_id, list);
  }

  return items.map((raw, index) => {
    const product = productByDocId.get(raw.product_id);
    if (!product) {
      throw new CheckoutError('ERR_STORE_MISMATCH', 403, `Product ${raw.product_id} not found in this store`, {
        details: { field: `items[${index}]` },
      });
    }
    if (!product.is_active) {
      throw new CheckoutError('PRODUCT_INACTIVE', 422, `Product ${product.sku} is inactive`, { details: { field: `items[${index}]` } });
    }
    const conversions = conversionsByProductId.get(product.id) ?? [];

    validateEnteredQty(product, raw.entered_qty);
    const qtyBase = toBase(raw.entered_qty, raw.entered_unit, conversions);

    let unitPricePaise: number;
    let priceSource: ResolvedItem['priceSource'];
    if (raw.price_source === 'MANUAL' && raw.unit_price_paise != null) {
      // Rule PR-3 tier 1 (manual override). No permission/audit token system
      // exists yet, so this is accepted at face value — documented gap.
      unitPricePaise = raw.unit_price_paise;
      priceSource = 'MANUAL';
    } else {
      const chosenUnitConv = findConversion(conversions, raw.entered_unit);
      if (chosenUnitConv.price_override_paise != null) {
        unitPricePaise = Number(chosenUnitConv.price_override_paise);
        priceSource = 'UNIT_OVERRIDE';
      } else {
        unitPricePaise = Number(product.sell_rate_paise);
        priceSource = 'PRODUCT';
      }
    }

    return {
      raw,
      product,
      conversions,
      qtyBase,
      unitPricePaise,
      priceSource,
      lineDiscount: raw.line_discount ?? null,
    };
  });
}

function lineGrossPaise(item: ResolvedItem): number {
  if (item.priceSource === 'PRODUCT') {
    const pricingConv = findConversion(item.conversions, item.product.pricing_unit);
    const ratePerBase = new Decimal(item.unitPricePaise).div(pricingConv.factor_to_base);
    return roundPaise(ratePerBase.mul(item.qtyBase));
  }
  return roundPaise(new Decimal(item.unitPricePaise).mul(item.raw.entered_qty));
}

/** Rule PR-2, normalised to pricing_unit. */
function exceedsMrp(item: ResolvedItem): boolean {
  const mrp = item.product.mrp_paise != null ? Number(item.product.mrp_paise) : null;
  if (mrp == null) return false;
  if (item.priceSource === 'PRODUCT') return item.unitPricePaise > mrp;
  const pricingConv = findConversion(item.conversions, item.product.pricing_unit);
  const enteredConv = findConversion(item.conversions, item.raw.entered_unit);
  const perPricingUnit = new Decimal(item.unitPricePaise).div(enteredConv.factor_to_base).mul(pricingConv.factor_to_base);
  return perPricingUnit.gt(mrp);
}

// ---------------------------------------------------------------------------
// FEFO allocation + locking (Rule FEFO-1..4, SYSTEM_ARCHITECTURE §4.1/§4.3)
// ---------------------------------------------------------------------------

interface BatchAllocation {
  batch: Record<string, any>;
  qtyBase: Decimal;
  wasOversold: boolean;
  isService: boolean;
}

/**
 * Milestone 4: a service line (labor, haircut, table charge, ...) has no
 * physical stock. This stands in for a real inventory_batches row so the
 * rest of the pipeline (order_items, response mapping) doesn't need two
 * parallel code paths — but it's never inserted into inventory_batches,
 * never locked, never decremented, and produces no stock_movements row.
 */
function servicePseudoBatch(product: Record<string, any>): Record<string, any> {
  return {
    id: null,
    document_id: null,
    batch_no: null,
    expiry_date: null,
    cost_price_paise: 0,
    landed_cost_paise: 0,
    current_stock_base: '0',
    received_at: new Date(),
    status: 'ACTIVE',
    product_id: product.id,
  };
}

async function getOrCreateDefaultBatch(trx: Knex.Transaction, storeId: number, product: Record<string, any>) {
  const existing = await trx('inventory_batches')
    .where({ store_id: storeId, product_id: product.id, batch_no: 'DEFAULT' })
    .first();
  if (existing) return existing;
  const [created] = await trx('inventory_batches')
    .insert({
      ...strapiRowStamps(),
      store_id: storeId,
      product_id: product.id,
      batch_no: 'DEFAULT',
      cost_price_paise: product.last_cost_paise ?? 0,
      landed_cost_paise: product.last_cost_paise ?? 0,
      opening_stock_base: 0,
      current_stock_base: 0,
      reserved_base: 0,
      received_at: new Date(),
      status: 'ACTIVE',
    })
    .returning('*');
  return created;
}

/**
 * Plans FEFO allocations for every item, then locks the full union of
 * candidate batch ids in one ascending-id `FOR UPDATE` query — the
 * deadlock-free ordering SYSTEM_ARCHITECTURE.md §4.3 requires — before
 * committing to a final per-item allocation against the now-locked rows.
 */
async function planAndLockBatches(
  trx: Knex.Transaction,
  storeId: number,
  items: ResolvedItem[],
  allowNegativeStock: boolean
): Promise<Map<ResolvedItem, BatchAllocation[]>> {
  const candidateIdsByItem = new Map<ResolvedItem, number[]>();
  const allCandidateIds = new Set<number>();

  const serviceItems = items.filter((item) => item.product.is_service);
  const physicalItems = items.filter((item) => !item.product.is_service);

  for (const item of physicalItems) {
    if (item.raw.batch_id) {
      const pinned = await trx('inventory_batches').where({ document_id: item.raw.batch_id, store_id: storeId }).first();
      if (!pinned) throw new CheckoutError('BATCH_NOT_FOUND', 422, `Batch ${item.raw.batch_id} not found`);
      candidateIdsByItem.set(item, [pinned.id]);
      allCandidateIds.add(pinned.id);
      continue;
    }
    const today = businessDateIso(new Date());
    const candidates = await trx('inventory_batches')
      .where({ store_id: storeId, product_id: item.product.id, status: 'ACTIVE' })
      .andWhere('current_stock_base', '>', 0)
      .andWhere((qb) => qb.whereNull('expiry_date').orWhere('expiry_date', '>=', today)) // Rule FEFO-3
      .orderByRaw('(expiry_date IS NULL) ASC, expiry_date ASC, received_at ASC, id ASC');
    const ids = candidates.map((c) => c.id);
    if (ids.length === 0) {
      const fallback = await getOrCreateDefaultBatch(trx, storeId, item.product);
      ids.push(fallback.id);
    }
    candidateIdsByItem.set(item, ids);
    ids.forEach((id) => allCandidateIds.add(id));
  }

  const sortedIds = Array.from(allCandidateIds).sort((a, b) => a - b);
  const locked = sortedIds.length
    ? await trx('inventory_batches').whereIn('id', sortedIds).orderBy('id', 'asc').forUpdate()
    : [];
  const lockedById = new Map(locked.map((b) => [b.id, b]));

  const allocationsByItem = new Map<ResolvedItem, BatchAllocation[]>();

  for (const item of serviceItems) {
    allocationsByItem.set(item, [{ batch: servicePseudoBatch(item.product), qtyBase: item.qtyBase, wasOversold: false, isService: true }]);
  }

  for (const item of physicalItems) {
    const candidateIds = candidateIdsByItem.get(item) ?? [];
    const orderedCandidates = item.raw.batch_id
      ? candidateIds.map((id) => lockedById.get(id)!)
      : [...candidateIds.map((id) => lockedById.get(id)!)].sort((a, b) => {
          const aExp = a.expiry_date ? new Date(a.expiry_date).getTime() : Infinity;
          const bExp = b.expiry_date ? new Date(b.expiry_date).getTime() : Infinity;
          if (aExp !== bExp) return aExp - bExp;
          const aRecv = new Date(a.received_at).getTime();
          const bRecv = new Date(b.received_at).getTime();
          if (aRecv !== bRecv) return aRecv - bRecv;
          return a.id - b.id;
        });

    let remaining = item.qtyBase;
    const allocations: BatchAllocation[] = [];
    for (const batch of orderedCandidates) {
      if (remaining.lte(0)) break;
      const available = new Decimal(batch.current_stock_base);
      const take = Decimal.min(available, remaining);
      if (take.gt(0)) {
        allocations.push({ batch, qtyBase: take, wasOversold: false, isService: false });
        remaining = remaining.minus(take);
      }
    }

    if (remaining.gt(0)) {
      if (!allowNegativeStock) {
        throw new CheckoutError('ERR_INSUFFICIENT_STOCK', 422, `Insufficient stock for product ${item.product.sku}`, {
          details: {
            product_id: item.product.document_id,
            requested_base: item.qtyBase.toString(),
            available_base: item.qtyBase.minus(remaining).toString(),
            shortfall_base: remaining.toString(),
          },
          resolutions: [
            { action: 'REDUCE_QTY', label: `Sell ${item.qtyBase.minus(remaining).toString()} instead` },
            { action: 'POST_AS_NEGATIVE', label: 'Post anyway and adjust', requires_permission: 'inventory.adjust' },
            { action: 'VOID', label: 'Cancel this bill' },
          ],
        });
      }
      const fallbackBatch = orderedCandidates[orderedCandidates.length - 1] ?? (await getOrCreateDefaultBatch(trx, storeId, item.product));
      allocations.push({ batch: fallbackBatch, qtyBase: remaining, wasOversold: true, isService: false });
    }

    allocationsByItem.set(item, allocations);
  }

  return allocationsByItem;
}

/** SYSTEM_ARCHITECTURE.md §4.2 — guarded even though we already hold the FOR UPDATE lock (defence in depth). */
async function decrementBatch(trx: Knex.Transaction, batchId: number, storeId: number, qtyBase: Decimal, allowNegative: boolean) {
  const result = await trx.raw(
    `UPDATE inventory_batches
        SET current_stock_base = current_stock_base - ?, updated_at = ${nowSql(trx)}
      WHERE id = ? AND store_id = ?
        AND (current_stock_base >= ? OR ?)
      RETURNING current_stock_base`,
    [qtyBase.toString(), batchId, storeId, qtyBase.toString(), allowNegative]
  );
  const rows = rawRows<{ current_stock_base: string }>(result, trx);
  if (rows.length === 0) {
    // Should be unreachable: we hold this row's FOR UPDATE lock for the whole
    // transaction, so nothing else could have changed it since we planned
    // against these exact numbers.
    throw new CheckoutError('ERR_BUSY_RETRY', 409, 'Unexpected lock contention on batch decrement');
  }
  return new Decimal(rows[0].current_stock_base);
}

// ---------------------------------------------------------------------------
// Invoice numbering (SYSTEM_ARCHITECTURE.md §4.4, ADR-06)
// ---------------------------------------------------------------------------

async function nextInvoiceNumber(
  trx: Knex.Transaction,
  storeId: number,
  counterId: number,
  counterCode: string,
  invoicePrefix: string,
  fy: string
): Promise<string> {
  await trx.raw(
    `INSERT INTO invoice_sequences (store_id, counter_id, financial_year, doc_type, last_value)
     VALUES (?, ?, ?, 'SALE', 0)
     ON CONFLICT (store_id, counter_id, financial_year, doc_type) DO NOTHING`,
    [storeId, counterId, fy]
  );
  const result = await trx.raw(
    `SELECT last_value FROM invoice_sequences
      WHERE store_id = ? AND counter_id = ? AND financial_year = ? AND doc_type = 'SALE'
      ${forUpdateSql(trx)}`,
    [storeId, counterId, fy]
  );
  const rows = rawRows<{ last_value: number }>(result, trx);
  const next = Number(rows[0].last_value) + 1;
  await trx.raw(
    `UPDATE invoice_sequences SET last_value = ?
      WHERE store_id = ? AND counter_id = ? AND financial_year = ? AND doc_type = 'SALE'`,
    [next, storeId, counterId, fy]
  );
  return `${invoicePrefix}/${fy}/${counterCode}/${String(next).padStart(6, '0')}`;
}

// ---------------------------------------------------------------------------
// Idempotency (API_CONTRACTS.md §2.4 step 1 / SYSTEM_ARCHITECTURE.md §3.4)
// ---------------------------------------------------------------------------

type IdempotencyOutcome = { kind: 'PROCEED' } | { kind: 'REPLAY'; response: unknown; httpStatus: number };

async function claimIdempotencyKey(trx: Knex.Transaction, storeId: number, key: string, route: string, body: unknown): Promise<IdempotencyOutcome> {
  const hash = requestHash(body);
  const insertResult = await trx.raw(
    `INSERT INTO idempotency_keys (key, store_id, route, request_hash, status)
     VALUES (?, ?, ?, ?, 'IN_PROGRESS')
     ON CONFLICT (store_id, key) DO NOTHING
     RETURNING key`,
    [key, storeId, route, hash]
  );
  if (rawRows(insertResult, trx).length > 0) return { kind: 'PROCEED' };

  const existing = await trx('idempotency_keys').where({ store_id: storeId, key }).first();
  if (!existing) return { kind: 'PROCEED' }; // race: retry as new (extremely unlikely)

  if (!existing.request_hash.equals(hash)) {
    throw new CheckoutError('IDEMPOTENCY_KEY_REUSED', 422, 'Idempotency-Key reused with a different payload');
  }
  if (existing.status === 'COMPLETED') {
    const response = typeof existing.response_json === 'string' ? JSON.parse(existing.response_json) : existing.response_json;
    return { kind: 'REPLAY', response, httpStatus: existing.http_status ?? 201 };
  }
  if (existing.status === 'IN_PROGRESS') {
    throw new CheckoutError('ERR_BUSY_RETRY', 409, 'This order is already being processed');
  }
  // FAILED — allow a fresh attempt.
  await trx('idempotency_keys').where({ store_id: storeId, key }).update({ status: 'IN_PROGRESS' });
  return { kind: 'PROCEED' };
}

async function completeIdempotencyKey(trx: Knex.Transaction, storeId: number, key: string, response: unknown, httpStatus: number) {
  await trx('idempotency_keys')
    .where({ store_id: storeId, key })
    .update({ status: 'COMPLETED', response_json: JSON.stringify(response), http_status: httpStatus, completed_at: new Date() });
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

export interface CreateOrderContext {
  storeDocumentId: string;
  idempotencyKey: string;
  cashierDocumentId?: string;
}

export async function createOrder(rawBody: unknown, ctx: CreateOrderContext) {
  const parsed = createOrderRequestSchema.safeParse(rawBody);
  if (!parsed.success) {
    throw new CheckoutError('ERR_VALIDATION', 400, parsed.error.issues.map((i) => i.message).join('; '), {
      details: { issues: parsed.error.issues },
    });
  }
  const body: CreateOrderRequest = parsed.data;
  if (body.client_uuid !== ctx.idempotencyKey) {
    throw new CheckoutError('ERR_VALIDATION', 400, 'Idempotency-Key header must equal client_uuid');
  }

  return strapi.db.connection.transaction(async (trx: Knex.Transaction) => {
    const store = await resolveStore(trx, ctx.storeDocumentId);

    const idem = await claimIdempotencyKey(trx, store.id, ctx.idempotencyKey, 'POST /api/checkout', body);
    if (idem.kind === 'REPLAY') return { response: idem.response, httpStatus: idem.httpStatus, replay: true };

    const config = typeof store.config === 'string' ? JSON.parse(store.config) : store.config ?? {};
    const allowNegativeStock: boolean = config?.inventory?.negative_stock_allowed ?? true;
    const roundOffMode: 'NEAREST' | 'UP' | 'DOWN' | 'NONE' = config?.tax?.round_off_mode ?? 'NEAREST';
    const creditEnforcement: 'BLOCK' | 'WARN' | 'ALLOW_WITH_APPROVAL' = config?.credit?.enforcement_mode ?? 'ALLOW_WITH_APPROVAL';
    const shiftEnabled: boolean = config?.shift?.enabled ?? false;

    const resolvedShift = await resolveShift(trx, store.id, shiftEnabled, body.shift_id);
    const shift = resolvedShift?.shift ?? null;
    // With a shift but no counter_id, bill on the shift's counter rather than
    // resolveCounter's "first counter in the store" fallback.
    const counter =
      !body.counter_id && resolvedShift ? resolvedShift.shiftCounter : await resolveCounter(trx, store.id, body.counter_id);
    if (resolvedShift && resolvedShift.shiftCounter.id !== counter.id) {
      throw new CheckoutError('ERR_STORE_MISMATCH', 403, `Shift ${body.shift_id} is open on a different counter than ${body.counter_id}`);
    }
    const cashier = await resolveCashier(trx, store.tenant_id, ctx.cashierDocumentId);
    const customer = await resolveCustomer(trx, store.id, body.customer_id);

    if (body.payments.some((p) => p.method === 'CREDIT') && !customer) {
      throw new CheckoutError('ERR_CUSTOMER_REQUIRED', 422, 'A customer is required for CREDIT payments');
    }

    const resolvedItems = await resolveItems(trx, store.id, body.items);

    for (const item of resolvedItems) {
      const hasApproval = (body.approval_tokens?.length ?? 0) > 0;
      if (exceedsMrp(item) && !hasApproval) {
        throw new CheckoutError('ERR_PRICE_ABOVE_MRP', 422, `Price exceeds MRP for ${item.product.sku}`, {
          details: { product_id: item.product.document_id },
        });
      }
    }

    const allocationsByItem = await planAndLockBatches(trx, store.id, resolvedItems, allowNegativeStock);

    const supplyType: 'INTRA_STATE' | 'INTER_STATE' =
      customer?.gstin && customer.state_code && customer.state_code !== store.state_code ? 'INTER_STATE' : 'INTRA_STATE';

    // One pricing line per allocation (Rule FEFO-1: one OrderItem per batch), sharing the parent item's line_group_id.
    // computeTotals() preserves input order, and the orderRows loop below walks
    // resolvedItems/allocationsByItem in this same order, so totals.lines[i]
    // lines up with orderRows[i] by construction.
    const pricingLines: PricingLine[] = [];

    for (const item of resolvedItems) {
      const allocations = allocationsByItem.get(item) ?? [];
      const totalGross = lineGrossPaise(item);
      let allocatedGrossSoFar = 0;
      allocations.forEach((allocation, idx) => {
        const share = allocation.qtyBase.div(item.qtyBase);
        const isLast = idx === allocations.length - 1;
        const grossForAlloc = isLast ? totalGross - allocatedGrossSoFar : roundPaise(new Decimal(totalGross).mul(share));
        allocatedGrossSoFar += grossForAlloc;

        pricingLines.push({
          line_group_id: `${item.raw.line_group_id}#${idx}`,
          gross_paise: grossForAlloc,
          discount_exempt: Boolean(item.product.discount_exempt),
          line_discount: idx === 0 ? item.lineDiscount : null, // discount applies once per visual line, on the first split
          gst_rate: Number(item.product.gst_rate),
          tax_inclusive: Boolean(item.product.tax_inclusive),
        });
      });
    }

    const totals = computeTotals({
      lines: pricingLines,
      cart_discount: body.cart_discount ?? null,
      charges_paise: (body.charges ?? []).reduce((sum, c) => sum + c.amount_paise, 0),
      supply_type: supplyType,
      round_off_mode: roundOffMode,
    });

    const paidPaise = body.payments.filter((p) => p.method !== 'CREDIT').reduce((sum, p) => sum + p.amount_paise, 0);
    const creditPaise = body.payments.filter((p) => p.method === 'CREDIT').reduce((sum, p) => sum + p.amount_paise, 0);
    if (paidPaise + creditPaise !== totals.total_paise) {
      throw new CheckoutError('ERR_PAYMENT_MISMATCH', 422, 'Payments do not sum to the invoice total', {
        details: { total_paise: totals.total_paise, paid_paise: paidPaise, credit_paise: creditPaise },
      });
    }

    if (creditPaise > 0 && customer) {
      const headroom = customer.credit_limit_enabled ? Number(customer.credit_limit_paise) - Number(customer.current_balance_paise) : null;
      if (headroom !== null && creditPaise > headroom) {
        const hasApproval = (body.approval_tokens?.length ?? 0) > 0;
        if (creditEnforcement === 'BLOCK' || (creditEnforcement === 'ALLOW_WITH_APPROVAL' && !hasApproval)) {
          throw new CheckoutError('ERR_CREDIT_LIMIT_BREACH', 422, 'Credit limit exceeded', {
            details: {
              customer_id: customer.document_id,
              limit_paise: Number(customer.credit_limit_paise),
              balance_paise: Number(customer.current_balance_paise),
              requested_credit_paise: creditPaise,
              overshoot_paise: creditPaise - headroom,
              enforcement_mode: creditEnforcement,
            },
            resolutions: [
              { action: 'APPROVE_OVERRIDE', label: 'Supervisor approval', requires_permission: 'credit.exceed_limit' },
              { action: 'CONVERT_TO_CASH', label: 'Take cash instead' },
            ],
          });
        }
        // WARN mode (or approved ALLOW_WITH_APPROVAL): proceed, audited below.
      }
    }

    // --- Stock decrement + movements ---
    const now = new Date();
    for (const [, allocations] of allocationsByItem) {
      for (const allocation of allocations) {
        if (allocation.isService) continue; // no physical stock to decrement
        const balanceAfter = await decrementBatch(trx, allocation.batch.id, store.id, allocation.qtyBase, allowNegativeStock);
        allocation.batch.current_stock_base = balanceAfter.toString(); // keep in sync for stock_after_base in the response
      }
    }

    const orderRows: Array<{ item: ResolvedItem; allocation: BatchAllocation; pricing: (typeof totals.lines)[number] }> = [];
    let lineMetaIndex = 0;
    for (const item of resolvedItems) {
      const allocations = allocationsByItem.get(item) ?? [];
      for (let idx = 0; idx < allocations.length; idx += 1) {
        const pricingLine = totals.lines[lineMetaIndex]!;
        orderRows.push({ item, allocation: allocations[idx]!, pricing: pricingLine });
        lineMetaIndex += 1;
      }
    }

    // --- Invoice number + order header ---
    const businessDate = businessDateIso(now);
    const fy = financialYear(now, store.financial_year_start);
    const invoiceNo = await nextInvoiceNumber(trx, store.id, counter.id, counter.code, resolveInvoicePrefix(store), fy);

    const [order] = await trx('orders')
      .insert({
        ...strapiRowStamps(),
        store_id: store.id,
        counter_id: counter.id,
        shift_id: shift?.id ?? null,
        customer_id: customer?.id ?? null,
        cashier_id: cashier.id,
        client_uuid: body.client_uuid,
        provisional_no: body.provisional_no ?? null,
        invoice_no: invoiceNo,
        financial_year: fy,
        order_type: 'SALE',
        status: 'COMPLETED',
        gross_paise: totals.gross_paise,
        line_discount_paise: totals.line_discount_paise,
        cart_discount_paise: totals.cart_discount_paise,
        taxable_value_paise: totals.taxable_value_paise,
        cgst_paise: totals.cgst_paise,
        sgst_paise: totals.sgst_paise,
        igst_paise: totals.igst_paise,
        cess_paise: totals.cess_paise,
        charges_paise: totals.charges_paise,
        round_off_paise: totals.round_off_paise,
        total_paise: totals.total_paise,
        paid_paise: paidPaise,
        credit_paise: creditPaise,
        cogs_paise: roundPaise(
          orderRows.reduce(
            (sum, r) => sum.plus(new Decimal(r.allocation.batch.cost_price_paise ?? 0).mul(r.allocation.qtyBase)),
            new Decimal(0)
          )
        ),
        supply_type: supplyType,
        settlement_status: creditPaise > 0 ? 'PARTIALLY_SETTLED' : 'SETTLED',
        is_offline_origin: body.is_offline_origin,
        client_created_at: body.client_created_at,
        server_created_at: now,
        business_date: businessDate,
        note: body.note ?? null,
        print_count: 0,
      })
      .returning('*');

    for (const row of orderRows) {
      if (row.allocation.isService) continue; // services produce no stock_movements row
      await trx('stock_movements').insert({
        store_id: store.id,
        product_id: row.item.product.id,
        batch_id: row.allocation.batch.id,
        movement_type: 'SALE',
        qty_base: row.allocation.qtyBase.neg().toString(),
        balance_after: row.allocation.batch.current_stock_base,
        unit_cost_paise: row.allocation.batch.cost_price_paise ?? row.allocation.batch.landed_cost_paise ?? 0,
        reference_type: 'ORDER',
        reference_id: order.id,
        created_by_id: cashier.id,
        occurred_at: now,
        created_at: now,
      });
    }

    const itemRows = [];
    for (const [lineNo, row] of orderRows.entries()) {
      const [itemRow] = await trx('order_items')
        .insert({
          ...strapiRowStamps(),
          order_id: order.id,
          store_id: store.id,
          product_id: row.item.product.id,
          batch_id: row.allocation.batch.id,
          line_group_id: row.item.raw.line_group_id,
          line_no: lineNo + 1,
          product_name: row.item.product.name,
          product_name_local: row.item.product.name_local,
          hsn_code: row.item.product.hsn_code,
          base_unit: row.item.product.base_unit,
          batch_no: row.allocation.batch.batch_no,
          expiry_date: row.allocation.batch.expiry_date,
          entered_qty: row.item.raw.entered_qty,
          entered_unit: row.item.raw.entered_unit,
          conversion_factor: findConversion(row.item.conversions, row.item.raw.entered_unit).factor_to_base,
          qty_base: row.allocation.qtyBase.toString(),
          unit_price_paise: row.item.unitPricePaise,
          price_source: row.item.priceSource,
          mrp_paise: row.item.product.mrp_paise,
          gross_paise: row.pricing.gross_paise,
          line_discount_paise: row.pricing.line_discount_paise,
          cart_discount_share_paise: row.pricing.cart_discount_share_paise,
          taxable_value_paise: row.pricing.taxable_value_paise,
          gst_rate: row.item.product.gst_rate,
          cgst_paise: row.pricing.cgst_paise,
          sgst_paise: row.pricing.sgst_paise,
          igst_paise: row.pricing.igst_paise,
          cess_paise: 0,
          tax_inclusive: row.item.product.tax_inclusive,
          line_total_paise: row.pricing.line_total_paise,
          unit_cost_paise: row.allocation.batch.cost_price_paise ?? 0,
          line_cogs_paise: roundPaise(new Decimal(row.allocation.batch.cost_price_paise ?? 0).mul(row.allocation.qtyBase)),
          returned_qty_base: 0,
          note: row.item.raw.note ?? null,
        })
        .returning('*');
      itemRows.push({ itemRow, row });
    }

    const paymentRows = [];
    for (const p of body.payments) {
      const [paymentRow] = await trx('order_payments')
        .insert({
          ...strapiRowStamps(),
          order_id: order.id,
          store_id: store.id,
          method: p.method,
          amount_paise: p.amount_paise,
          tendered_paise: p.tendered_paise ?? null,
          change_paise: p.tendered_paise != null ? p.tendered_paise - p.amount_paise : null,
          reference: p.reference ?? null,
          provider: p.provider ?? null,
        })
        .returning('*');
      paymentRows.push(paymentRow);
    }

    let ledgerEntry = null;
    let balanceBefore = customer ? Number(customer.current_balance_paise) : 0;
    let balanceAfter = balanceBefore;
    if (creditPaise > 0 && customer) {
      ledgerEntry = await postEntry(trx, {
        storeId: store.id,
        customerId: customer.id,
        entryType: 'SALE_CREDIT',
        direction: 'DEBIT',
        amountPaise: creditPaise,
        entryDate: businessDate,
        referenceType: 'ORDER',
        referenceId: order.id,
        createdById: cashier.id,
      });
      balanceAfter = Number(ledgerEntry.running_balance_paise);
    }

    // Rule SH-3 / SYSTEM_ARCHITECTURE.md §4.1 step 12. No-op (shift is null)
    // for any store that doesn't have shifts enabled — Milestone 3 behaviour
    // is unchanged in that case.
    if (shift) {
      const cashPaise = body.payments.filter((p) => p.method === 'CASH').reduce((sum, p) => sum + p.amount_paise, 0);
      const cardPaise = body.payments.filter((p) => p.method === 'CARD').reduce((sum, p) => sum + p.amount_paise, 0);
      const upiPaise = body.payments.filter((p) => p.method === 'UPI').reduce((sum, p) => sum + p.amount_paise, 0);
      const walletPaise = body.payments.filter((p) => p.method === 'WALLET').reduce((sum, p) => sum + p.amount_paise, 0);
      await trx('shifts')
        .where({ id: shift.id })
        .update({
          cash_sales_paise: trx.raw('cash_sales_paise + ?', [cashPaise]),
          card_sales_paise: trx.raw('card_sales_paise + ?', [cardPaise]),
          upi_sales_paise: trx.raw('upi_sales_paise + ?', [upiPaise]),
          wallet_sales_paise: trx.raw('wallet_sales_paise + ?', [walletPaise]),
          credit_sales_paise: trx.raw('credit_sales_paise + ?', [creditPaise]),
          bill_count: trx.raw('bill_count + 1'),
          discount_total_paise: trx.raw('discount_total_paise + ?', [totals.line_discount_paise + totals.cart_discount_paise]),
          updated_at: now,
        });
    }

    if ((body.approval_tokens?.length ?? 0) > 0) {
      await writeAuditLog(trx, {
        store_id: store.id,
        actor_user_id: cashier.id,
        action: 'ORDER_OVERRIDE_APPLIED',
        entity_type: 'order',
        entity_id: order.id,
        after_json: { approval_tokens: body.approval_tokens, total_paise: totals.total_paise },
        reason_code: 'CHECKOUT_OVERRIDE',
      });
    }

    const response = {
      order: {
        id: order.document_id,
        invoice_no: order.invoice_no,
        provisional_no: order.provisional_no ?? undefined,
        financial_year: order.financial_year,
        business_date: order.business_date,
        server_created_at: now.toISOString(),
        status: 'COMPLETED',
        settlement_status: order.settlement_status,
        supply_type: order.supply_type,
      },
      totals: {
        gross_paise: totals.gross_paise,
        line_discount_paise: totals.line_discount_paise,
        cart_discount_paise: totals.cart_discount_paise,
        taxable_value_paise: totals.taxable_value_paise,
        cgst_paise: totals.cgst_paise,
        sgst_paise: totals.sgst_paise,
        igst_paise: totals.igst_paise,
        cess_paise: totals.cess_paise,
        charges_paise: totals.charges_paise,
        round_off_paise: totals.round_off_paise,
        total_paise: totals.total_paise,
        paid_paise: paidPaise,
        credit_paise: creditPaise,
        tax_breakup: totals.tax_breakup,
        item_count: orderRows.length,
        total_qty_display: `${resolvedItems.length} item(s)`,
      },
      items: itemRows.map(({ itemRow, row }) => ({
        line_group_id: row.item.raw.line_group_id,
        line_no: itemRow.line_no,
        product_id: row.item.product.document_id,
        product_name: itemRow.product_name,
        product_name_local: itemRow.product_name_local ?? undefined,
        hsn_code: itemRow.hsn_code ?? undefined,
        batch_id: row.allocation.batch.document_id ?? undefined,
        batch_no: itemRow.batch_no ?? undefined,
        expiry_date: itemRow.expiry_date ?? undefined,
        entered_qty: itemRow.entered_qty,
        entered_unit: itemRow.entered_unit,
        qty_base: itemRow.qty_base,
        base_unit: itemRow.base_unit,
        unit_price_paise: itemRow.unit_price_paise,
        price_source: itemRow.price_source,
        gross_paise: itemRow.gross_paise,
        line_discount_paise: itemRow.line_discount_paise,
        cart_discount_share_paise: itemRow.cart_discount_share_paise,
        taxable_value_paise: itemRow.taxable_value_paise,
        gst_rate: Number(itemRow.gst_rate),
        cgst_paise: itemRow.cgst_paise,
        sgst_paise: itemRow.sgst_paise,
        igst_paise: itemRow.igst_paise,
        line_total_paise: itemRow.line_total_paise,
        stock_after_base: row.allocation.batch.current_stock_base,
        was_oversold: row.allocation.wasOversold,
      })),
      payments: paymentRows.map((p) => ({ method: p.method, amount_paise: p.amount_paise, change_paise: p.change_paise ?? undefined })),
      customer: customer
        ? {
            id: customer.document_id,
            name: customer.name,
            balance_before_paise: balanceBefore,
            balance_after_paise: balanceAfter,
            credit_headroom_paise: customer.credit_limit_enabled ? Number(customer.credit_limit_paise) - balanceAfter : null,
          }
        : undefined,
      warnings: orderRows.some((r) => r.allocation.wasOversold)
        ? [{ code: 'WAS_OVERSOLD', message: 'One or more lines were sold from negative stock' }]
        : undefined,
      print_payload: buildPrintPayload({ store, counter, cashier, customer, order, itemRows, paymentRows, totals, businessDate, now }),
    };

    await completeIdempotencyKey(trx, store.id, ctx.idempotencyKey, response, 201);

    return { response, httpStatus: 201, replay: false };
  });
}

// ---------------------------------------------------------------------------
// Print payload (API_CONTRACTS.md §2.5)
// ---------------------------------------------------------------------------

function buildPrintPayload(args: {
  store: Record<string, any>;
  counter: Record<string, any>;
  cashier: Record<string, any>;
  customer: Record<string, any> | null;
  order: Record<string, any>;
  itemRows: Array<{ itemRow: Record<string, any> }>;
  paymentRows: Record<string, any>[];
  totals: ReturnType<typeof computeTotals>;
  businessDate: string;
  now: Date;
}) {
  const { store, counter, cashier, customer, order, itemRows, paymentRows, totals, now } = args;
  return {
    template: 'RECEIPT_58' as const,
    language: 'en' as const,
    render_mode: 'TEXT' as const,
    copies: 1,
    mark_provisional: order.is_offline_origin,
    header: { store_name: store.name, address_lines: [store.address_line_1, store.address_line_2].filter(Boolean), phone: store.phone, gstin: store.gstin },
    meta: {
      invoice_no: order.invoice_no,
      date_display: now.toLocaleDateString('en-IN'),
      time_display: now.toLocaleTimeString('en-IN'),
      cashier: cashier.full_name,
      counter: counter.code,
      customer: customer ? { name: customer.name, phone_masked: customer.phone_last_4 ? `••${customer.phone_last_4}` : undefined } : undefined,
    },
    lines: itemRows.map(({ itemRow }) => ({
      name: itemRow.product_name,
      qty_display: `${itemRow.entered_qty} ${itemRow.entered_unit}`,
      rate_display: (itemRow.unit_price_paise / 100).toFixed(2),
      amount_display: (itemRow.line_total_paise / 100).toFixed(2),
      batch_display: itemRow.batch_no,
    })),
    totals_block: [
      { label: 'Subtotal', value: (totals.taxable_value_paise / 100).toFixed(2) },
      { label: 'Tax', value: (totals.tax_breakup.reduce((s, t) => s + t.cgst_paise + t.sgst_paise + t.igst_paise, 0) / 100).toFixed(2) },
      { label: 'Round off', value: (totals.round_off_paise / 100).toFixed(2) },
      { label: 'Total', value: (totals.total_paise / 100).toFixed(2), emphasis: true },
    ],
    tax_block: totals.tax_breakup.map((t) => ({
      rate: `${t.rate}%`,
      taxable: (t.taxable_paise / 100).toFixed(2),
      cgst: (t.cgst_paise / 100).toFixed(2),
      sgst: (t.sgst_paise / 100).toFixed(2),
    })),
    payments_block: paymentRows.map((p) => ({ label: p.method, value: (p.amount_paise / 100).toFixed(2) })),
    footer_lines: ['Thank you for shopping with us!'],
    open_drawer: paymentRows.some((p) => p.method === 'CASH'),
  };
}
