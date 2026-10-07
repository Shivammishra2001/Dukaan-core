import Decimal from 'decimal.js';
import type { Core } from '@strapi/strapi';
import type { Knex } from 'knex';
import { AppError } from '../../../services/errors';
import { findConversion, toBase, validateEnteredQty, type UnitConversionRow } from '../../../services/units';
import { computeTotals, roundPaise, type PricingLine } from '../../../services/pricing';
import { businessDateIso, financialYear } from '../../../services/business-date';
import { strapiRowStamps } from '../../../services/strapi-row';
import { nowSql, forUpdateSql, rawRows } from '../../../services/sql-dialect';
import {
  bookB2bOrderSchema,
  dispatchB2bOrderSchema,
  deliverB2bOrderSchema,
  type BookB2bOrderItemInput,
  type BookB2bOrderRequest,
} from './b2b-dispatch-dto';
import { postEntry } from '../../customer/services/ledger';
import { resolveInvoicePrefix } from '../../../services/invoice-prefix';

declare const strapi: Core.Strapi;

/**
 * Milestone 6: BOOKED -> DISPATCHED -> DELIVERED. Stock only moves at
 * DELIVERED (per the brief's own bullet: "DELIVERED (Invoice generated &
 * Stock decremented)") — booking and dispatch never touch inventory_batches.
 *
 * The FEFO-lock-decrement block in `deliverOrder()` is a deliberate,
 * near-verbatim duplicate of checkout.service.ts's — NOT extracted into a
 * shared module, on purpose: refactoring the verified Milestone 3 checkout
 * transaction carries real regression risk for a "zero breaking changes"
 * requirement, and this module needs to work correctly on its own either
 * way. `src/services/fefo-allocation.ts` extracting both is a reasonable
 * follow-up once both call sites are stable.
 */

async function resolveStore(trx: Knex.Transaction, storeDocumentId: string) {
  const store = await trx('stores').where({ document_id: storeDocumentId }).first();
  if (!store) throw new AppError('ERR_STORE_MISMATCH', 403, `Unknown store ${storeDocumentId}`);
  return store;
}

async function resolveCustomer(trx: Knex.Transaction, storeId: number, customerDocumentId: string) {
  const customer = await trx('customers').where({ document_id: customerDocumentId, store_id: storeId }).first();
  if (!customer) throw new AppError('ERR_STORE_MISMATCH', 403, `Customer ${customerDocumentId} does not belong to this store`);
  return customer;
}

async function resolveCreatedBy(trx: Knex.Transaction, tenantId: number) {
  const existing = await trx('app_users').where({ tenant_id: tenantId, full_name: 'System Cashier' }).first();
  if (existing) return existing;
  const [created] = await trx('app_users').insert({ ...strapiRowStamps(), tenant_id: tenantId, full_name: 'System Cashier', is_active: true }).returning('*');
  return created;
}

/**
 * Multi-tier wholesale pricing (Milestone B2B addition — no schema for this
 * in DATABASE_SCHEMA.md). Tiers are keyed off the line's quantity expressed
 * in the product's own `default_purchase_unit` (its bulk/carton unit),
 * regardless of which unit the line was actually entered in. A manual
 * `unit_price_paise` on the request line always wins (store-owner override).
 */
function selectWholesaleRatePaise(product: Record<string, any>, conversions: UnitConversionRow[], qtyBase: Decimal): number {
  const purchaseConv = conversions.find((c) => c.unit_code === product.default_purchase_unit);
  const qtyInPurchaseUnit = purchaseConv ? qtyBase.div(purchaseConv.factor_to_base) : qtyBase;
  // Strapi's naming strategy inserts underscores around a digit that
  // directly follows a letter (same quirk as b2b_order_item's b_2_b_order_id
  // FK column) — the schema.json attribute is wholesale_tier1_rate_paise,
  // but raw Knex sees the actual DB column wholesale_tier_1_rate_paise.
  // Only raw SQL/Knex is affected; the Content API still serializes the
  // attribute name (wholesale_tier1_rate_paise) to API consumers.
  const tier1 = product.wholesale_tier_1_rate_paise != null ? Number(product.wholesale_tier_1_rate_paise) : null;
  const tier2 = product.wholesale_tier_2_rate_paise != null ? Number(product.wholesale_tier_2_rate_paise) : null;
  const sellRate = Number(product.sell_rate_paise);

  if (qtyInPurchaseUnit.gte(20)) return tier2 ?? tier1 ?? sellRate;
  if (qtyInPurchaseUnit.gte(5)) return tier1 ?? sellRate;
  return sellRate;
}

/** Live unallocated batch availability check at booking time (in addition to the hard enforcement already at deliverB2bOrder's FEFO allocation) — a wholesale order shouldn't book against stock that plainly isn't there. */
async function assertBatchAvailability(trx: Knex.Transaction, storeId: number, allowNegativeStock: boolean, items: ResolvedBookItem[]) {
  if (allowNegativeStock) return;
  const requiredByProduct = new Map<number, Decimal>();
  for (const item of items) {
    requiredByProduct.set(item.product.id, (requiredByProduct.get(item.product.id) ?? new Decimal(0)).plus(item.qtyBase));
  }
  for (const [productId, required] of requiredByProduct) {
    const rows = await trx('inventory_batches').where({ store_id: storeId, product_id: productId, status: 'ACTIVE' }).andWhere('current_stock_base', '>', 0);
    const available = rows.reduce((sum, b) => sum.plus(b.current_stock_base), new Decimal(0));
    if (available.lt(required)) {
      throw new AppError('ERR_INSUFFICIENT_STOCK', 422, `Insufficient unallocated stock for product ${productId}`, {
        details: { product_id: productId, requested_base: required.toString(), available_base: available.toString() },
      });
    }
  }
}

// ---------------------------------------------------------------------------
// Book
// ---------------------------------------------------------------------------

interface ResolvedBookItem {
  raw: BookB2bOrderItemInput;
  product: Record<string, any>;
  conversions: UnitConversionRow[];
  qtyBase: Decimal;
  unitPricePaise: number;
}

export interface BookB2bOrderContext {
  storeDocumentId: string;
  idempotencyKey: string;
}

export async function bookB2bOrder(rawBody: unknown, ctx: BookB2bOrderContext) {
  const parsed = bookB2bOrderSchema.safeParse(rawBody);
  if (!parsed.success) throw new AppError('ERR_VALIDATION', 400, parsed.error.issues.map((i) => i.message).join('; '));
  const body: BookB2bOrderRequest = parsed.data;
  if (body.client_uuid !== ctx.idempotencyKey) throw new AppError('ERR_VALIDATION', 400, 'Idempotency-Key header must equal client_uuid');

  return strapi.db.connection.transaction(async (trx: Knex.Transaction) => {
    const store = await resolveStore(trx, ctx.storeDocumentId);

    const existing = await trx('b2b_orders').where({ store_id: store.id, client_uuid: body.client_uuid }).first();
    if (existing) return { order: existing, replay: true };

    const customer = await resolveCustomer(trx, store.id, body.customer_id);
    const createdBy = await resolveCreatedBy(trx, store.tenant_id);

    const productIds = Array.from(new Set(body.items.map((i) => i.product_id)));
    const products = await trx('products').whereIn('document_id', productIds).andWhere({ store_id: store.id });
    const productByDocId = new Map(products.map((p) => [p.document_id, p]));
    const allConversions: UnitConversionRow[] = await trx('unit_conversions').whereIn('product_id', products.map((p) => p.id));
    const conversionsByProductId = new Map<number, UnitConversionRow[]>();
    for (const c of allConversions) {
      const list = conversionsByProductId.get(c.product_id) ?? [];
      list.push(c);
      conversionsByProductId.set(c.product_id, list);
    }

    const resolvedItems: ResolvedBookItem[] = body.items.map((raw, idx) => {
      const product = productByDocId.get(raw.product_id);
      if (!product) throw new AppError('ERR_STORE_MISMATCH', 403, `Product ${raw.product_id} not found in this store`, { details: { field: `items[${idx}]` } });
      const conversions = conversionsByProductId.get(product.id) ?? [];
      validateEnteredQty(product, raw.entered_qty);
      const qtyBase = toBase(raw.entered_qty, raw.entered_unit, conversions);
      const unitPricePaise = raw.unit_price_paise ?? selectWholesaleRatePaise(product, conversions, qtyBase);
      return { raw, product, conversions, qtyBase, unitPricePaise };
    });

    const config = typeof store.config === 'string' ? JSON.parse(store.config) : (store.config ?? {});
    const allowNegativeStock: boolean = config?.inventory?.negative_stock_allowed ?? true;
    await assertBatchAvailability(trx, store.id, allowNegativeStock, resolvedItems);

    const pricingLines: PricingLine[] = resolvedItems.map((item) => {
      const pricingConv = findConversion(item.conversions, item.product.pricing_unit);
      const ratePerBase = new Decimal(item.unitPricePaise).div(pricingConv.factor_to_base);
      const gross = roundPaise(ratePerBase.mul(item.qtyBase));
      return {
        line_group_id: item.raw.product_id,
        gross_paise: gross,
        discount_exempt: Boolean(item.product.discount_exempt),
        line_discount: null,
        gst_rate: Number(item.product.gst_rate),
        tax_inclusive: Boolean(item.product.tax_inclusive),
      };
    });

    const supplyType = customer.gstin && customer.state_code && customer.state_code !== store.state_code ? 'INTER_STATE' : 'INTRA_STATE';
    const totals = computeTotals({
      lines: pricingLines,
      cart_discount: null,
      charges_paise: 0,
      supply_type: supplyType,
      round_off_mode: config?.tax?.round_off_mode ?? 'NEAREST',
    });

    const now = new Date();
    const businessDate = businessDateIso(now);

    const [order] = await trx('b2b_orders')
      .insert({
        ...strapiRowStamps(),
        store_id: store.id,
        customer_id: customer.id,
        client_uuid: body.client_uuid,
        route: body.route ?? null,
        vehicle_no: body.vehicle_no ?? null,
        status: 'BOOKED',
        subtotal_paise: totals.taxable_value_paise,
        tax_paise: totals.cgst_paise + totals.sgst_paise + totals.igst_paise,
        round_off_paise: totals.round_off_paise,
        total_paise: totals.total_paise,
        booked_at: now,
        business_date: businessDate,
        note: body.note ?? null,
      })
      .returning('*');

    const itemRows = [];
    for (let idx = 0; idx < resolvedItems.length; idx += 1) {
      const item = resolvedItems[idx]!;
      const line = totals.lines[idx]!;
      const conv = findConversion(item.conversions, item.raw.entered_unit);
      const [itemRow] = await trx('b2b_order_items')
        .insert({
          ...strapiRowStamps(),
          store_id: store.id,
          // Strapi's naming strategy renders the `b2b_order` relation attribute's FK
          // column as `b_2_b_order_id` (its camelCase->snake_case conversion inserts
          // underscores around each digit), not the more intuitive `b2b_order_id`.
          b_2_b_order_id: order.id,
          product_id: item.product.id,
          entered_qty: item.raw.entered_qty,
          entered_unit: item.raw.entered_unit,
          conversion_factor: conv.factor_to_base,
          qty_base: item.qtyBase.toString(),
          unit_price_paise: item.unitPricePaise,
          gst_rate: item.product.gst_rate,
          taxable_value_paise: line.taxable_value_paise,
          cgst_paise: line.cgst_paise,
          sgst_paise: line.sgst_paise,
          igst_paise: line.igst_paise,
          line_total_paise: line.line_total_paise,
        })
        .returning('*');
      itemRows.push(itemRow);
    }

    void createdBy; // resolved for symmetry with the other services; no created_by_id column on b2b_orders yet

    // Customer credit headroom, surfaced for the booking UI (REQUIREMENTS.md
    // §4.2 default enforcement is ALLOW_WITH_APPROVAL — informational here,
    // not blocking; the store owner sees it and decides).
    const customerBalanceAfter = Number(customer.current_balance_paise) + Number(order.total_paise);
    const creditLimitPaise = Number(customer.credit_limit_paise);
    const customerCredit = {
      credit_limit_enabled: Boolean(customer.credit_limit_enabled),
      credit_limit_paise: creditLimitPaise,
      balance_before_paise: Number(customer.current_balance_paise),
      balance_after_paise: customerBalanceAfter,
      headroom_paise: customer.credit_limit_enabled ? creditLimitPaise - customerBalanceAfter : null,
      would_exceed_limit: Boolean(customer.credit_limit_enabled) && customerBalanceAfter > creditLimitPaise,
    };

    return { order, items: itemRows, totals, customer_credit: customerCredit, replay: false };
  });
}

// ---------------------------------------------------------------------------
// Loading sheet (Part 2's "Loading Sheet / Packing List aggregation")
// ---------------------------------------------------------------------------

export async function buildLoadingSheet(storeDocumentId: string, orderDocumentIds: string[]) {
  const knex = strapi.db.connection;
  const store = await knex('stores').where({ document_id: storeDocumentId }).first();
  if (!store) throw new AppError('ERR_STORE_MISMATCH', 403, 'Unknown store');

  const orders = await knex('b2b_orders').whereIn('document_id', orderDocumentIds).andWhere({ store_id: store.id, status: 'BOOKED' });
  if (orders.length === 0) throw new AppError('ERR_VALIDATION', 400, 'No BOOKED orders found for the given ids');

  const items = await knex('b2b_order_items').whereIn(
    'b_2_b_order_id',
    orders.map((o) => o.id)
  );
  const productIds = Array.from(new Set(items.map((i) => i.product_id)));
  const products = await knex('products').whereIn('id', productIds);
  const productById = new Map(products.map((p) => [p.id, p]));
  const conversions: UnitConversionRow[] = await knex('unit_conversions').whereIn('product_id', productIds);
  const conversionsByProduct = new Map<number, UnitConversionRow[]>();
  for (const c of conversions) {
    const list = conversionsByProduct.get(c.product_id) ?? [];
    list.push(c);
    conversionsByProduct.set(c.product_id, list);
  }

  const totalsByProduct = new Map<number, Decimal>();
  for (const item of items) {
    totalsByProduct.set(item.product_id, (totalsByProduct.get(item.product_id) ?? new Decimal(0)).plus(item.qty_base));
  }

  const lines = Array.from(totalsByProduct.entries()).map(([productId, qtyBase]) => {
    const product = productById.get(productId)!;
    const convs = conversionsByProduct.get(productId) ?? [];
    // "Packing unit" = the largest bulk purchase unit (e.g. BORI/CARTON) — the "Gattas/Units" the brief asks the sheet to group by.
    const packingConv = [...convs].filter((c) => c.is_purchase_unit).sort((a, b) => Number(b.factor_to_base) - Number(a.factor_to_base))[0];
    const packingQty = packingConv ? qtyBase.div(packingConv.factor_to_base) : qtyBase;
    return {
      product_id: product.document_id,
      product_name: product.name,
      base_unit: product.base_unit,
      total_qty_base: qtyBase.toString(),
      packing_unit: packingConv?.unit_code ?? product.base_unit,
      packing_qty_display: packingQty.toDecimalPlaces(2).toString(),
    };
  });

  return { order_count: orders.length, order_ids: orders.map((o) => o.document_id), lines };
}

// ---------------------------------------------------------------------------
// Dispatch
// ---------------------------------------------------------------------------

async function nextChallanNo(trx: Knex.Transaction, storeId: number, fy: string): Promise<string> {
  await trx.raw(`INSERT INTO challan_sequences (store_id, financial_year, last_value) VALUES (?, ?, 0) ON CONFLICT (store_id, financial_year) DO NOTHING`, [storeId, fy]);
  const result = await trx.raw(`SELECT last_value FROM challan_sequences WHERE store_id = ? AND financial_year = ? ${forUpdateSql(trx)}`, [storeId, fy]);
  const rows = rawRows<{ last_value: number }>(result, trx);
  const next = Number(rows[0].last_value) + 1;
  await trx.raw(`UPDATE challan_sequences SET last_value = ? WHERE store_id = ? AND financial_year = ?`, [next, storeId, fy]);
  const year = fy.split('-')[0];
  return `CHAL-${year}-${String(next).padStart(4, '0')}`;
}

export async function dispatchB2bOrders(rawBody: unknown, storeDocumentId: string) {
  const parsed = dispatchB2bOrderSchema.safeParse(rawBody);
  if (!parsed.success) throw new AppError('ERR_VALIDATION', 400, parsed.error.issues.map((i) => i.message).join('; '));
  const body = parsed.data;

  return strapi.db.connection.transaction(async (trx: Knex.Transaction) => {
    const store = await resolveStore(trx, storeDocumentId);
    const orders = await trx('b2b_orders').whereIn('document_id', body.order_ids).andWhere({ store_id: store.id }).forUpdate();
    if (orders.length !== body.order_ids.length) throw new AppError('ERR_NOT_FOUND', 404, 'One or more order ids were not found for this store');
    if (orders.some((o) => o.status !== 'BOOKED')) throw new AppError('ERR_VALIDATION', 422, 'All orders must be BOOKED to dispatch together');

    const now = new Date();
    const fy = financialYear(now, store.financial_year_start);
    const challanNo = await nextChallanNo(trx, store.id, fy);

    const updatePayload: Record<string, unknown> = { status: 'DISPATCHED', challan_no: challanNo, dispatched_at: now, updated_at: now };
    if (body.vehicle_no) updatePayload.vehicle_no = body.vehicle_no; // omitted -> keep each order's own booking-time value
    if (body.transporter) updatePayload.transporter = body.transporter;
    if (body.driver_name) updatePayload.driver_name = body.driver_name;
    if (body.freight_paise != null) updatePayload.freight_paise = body.freight_paise;
    if (body.freight_terms) updatePayload.freight_terms = body.freight_terms;

    await trx('b2b_orders')
      .whereIn('id', orders.map((o) => o.id))
      .update(updatePayload);

    return {
      challan_no: challanNo,
      order_ids: orders.map((o) => o.document_id),
      dispatched_at: now.toISOString(),
      vehicle_no: (updatePayload.vehicle_no as string | undefined) ?? null,
      transporter: (updatePayload.transporter as string | undefined) ?? null,
      driver_name: (updatePayload.driver_name as string | undefined) ?? null,
      freight_paise: (updatePayload.freight_paise as number | undefined) ?? 0,
      freight_terms: (updatePayload.freight_terms as string | undefined) ?? null,
    };
  });
}

// ---------------------------------------------------------------------------
// Deliver (stock decrements here — duplicated FEFO logic, see module doc comment)
// ---------------------------------------------------------------------------

async function nextInvoiceNumberShared(trx: Knex.Transaction, storeId: number, counterId: number, counterCode: string, invoicePrefix: string, fy: string): Promise<string> {
  await trx.raw(
    `INSERT INTO invoice_sequences (store_id, counter_id, financial_year, doc_type, last_value) VALUES (?, ?, ?, 'SALE', 0) ON CONFLICT (store_id, counter_id, financial_year, doc_type) DO NOTHING`,
    [storeId, counterId, fy]
  );
  const result = await trx.raw(
    `SELECT last_value FROM invoice_sequences WHERE store_id = ? AND counter_id = ? AND financial_year = ? AND doc_type = 'SALE' ${forUpdateSql(trx)}`,
    [storeId, counterId, fy]
  );
  const rows = rawRows<{ last_value: number }>(result, trx);
  const next = Number(rows[0].last_value) + 1;
  await trx.raw(`UPDATE invoice_sequences SET last_value = ? WHERE store_id = ? AND counter_id = ? AND financial_year = ? AND doc_type = 'SALE'`, [next, storeId, counterId, fy]);
  return `${invoicePrefix}/${fy}/${counterCode}/${String(next).padStart(6, '0')}`;
}

export async function deliverB2bOrder(rawBody: unknown, storeDocumentId: string) {
  const parsed = deliverB2bOrderSchema.safeParse(rawBody);
  if (!parsed.success) throw new AppError('ERR_VALIDATION', 400, parsed.error.issues.map((i) => i.message).join('; '));
  const { order_id } = parsed.data;

  return strapi.db.connection.transaction(async (trx: Knex.Transaction) => {
    const store = await resolveStore(trx, storeDocumentId);
    const order = await trx('b2b_orders').where({ document_id: order_id, store_id: store.id }).first();
    if (!order) throw new AppError('ERR_NOT_FOUND', 404, `B2B order ${order_id} not found`);
    if (order.status !== 'DISPATCHED') throw new AppError('ERR_VALIDATION', 422, 'Order must be DISPATCHED before it can be marked DELIVERED');

    const items = await trx('b2b_order_items').where({ b_2_b_order_id: order.id });
    const config = typeof store.config === 'string' ? JSON.parse(store.config) : (store.config ?? {});
    const allowNegativeStock: boolean = config?.inventory?.negative_stock_allowed ?? true;
    const now = new Date();
    const businessDate = businessDateIso(now);

    // --- FEFO plan + global ascending-id lock (duplicated from checkout.service.ts) ---
    const candidateIdsByItem = new Map<number, number[]>();
    const allCandidateIds = new Set<number>();
    for (const item of items) {
      const candidates = await trx('inventory_batches')
        .where({ store_id: store.id, product_id: item.product_id, status: 'ACTIVE' })
        .andWhere('current_stock_base', '>', 0)
        .andWhere((qb) => qb.whereNull('expiry_date').orWhere('expiry_date', '>=', businessDate))
        .orderByRaw('(expiry_date IS NULL) ASC, expiry_date ASC, received_at ASC, id ASC');
      const ids = candidates.map((c) => c.id);
      candidateIdsByItem.set(item.id, ids);
      ids.forEach((id) => allCandidateIds.add(id));
    }
    const sortedIds = Array.from(allCandidateIds).sort((a, b) => a - b);
    const locked = sortedIds.length ? await trx('inventory_batches').whereIn('id', sortedIds).orderBy('id', 'asc').forUpdate() : [];
    const lockedById = new Map(locked.map((b) => [b.id, b]));

    let taxTotal = 0;
    let subtotal = 0;
    for (const item of items) {
      const ids = candidateIdsByItem.get(item.id) ?? [];
      const orderedCandidates = ids
        .map((id) => lockedById.get(id)!)
        .sort((a, b) => {
          const aExp = a.expiry_date ? new Date(a.expiry_date).getTime() : Infinity;
          const bExp = b.expiry_date ? new Date(b.expiry_date).getTime() : Infinity;
          if (aExp !== bExp) return aExp - bExp;
          const aRecv = new Date(a.received_at).getTime();
          const bRecv = new Date(b.received_at).getTime();
          if (aRecv !== bRecv) return aRecv - bRecv;
          return a.id - b.id;
        });

      let remaining = new Decimal(item.qty_base);
      const allocations: { batch: Record<string, any>; qty: Decimal }[] = [];
      for (const batch of orderedCandidates) {
        if (remaining.lte(0)) break;
        const take = Decimal.min(new Decimal(batch.current_stock_base), remaining);
        if (take.gt(0)) {
          allocations.push({ batch, qty: take });
          remaining = remaining.minus(take);
        }
      }
      if (remaining.gt(0) && !allowNegativeStock) {
        throw new AppError('ERR_INSUFFICIENT_STOCK', 422, `Insufficient stock for product ${item.product_id}`, {
          details: { requested_base: item.qty_base, shortfall_base: remaining.toString() },
        });
      }
      if (remaining.gt(0)) {
        const fallback = orderedCandidates[orderedCandidates.length - 1];
        if (fallback) allocations.push({ batch: fallback, qty: remaining });
      }

      for (const alloc of allocations) {
        const result = await trx.raw(
          `UPDATE inventory_batches SET current_stock_base = current_stock_base - ?, updated_at = ${nowSql(trx)}
             WHERE id = ? AND store_id = ? AND (current_stock_base >= ? OR ?) RETURNING current_stock_base`,
          [alloc.qty.toString(), alloc.batch.id, store.id, alloc.qty.toString(), allowNegativeStock]
        );
        const rows = rawRows<{ current_stock_base: string }>(result, trx);
        if (rows.length === 0) throw new AppError('ERR_BUSY_RETRY', 409, 'Unexpected lock contention on batch decrement');
        const balanceAfter = rows[0].current_stock_base;

        await trx('stock_movements').insert({
          store_id: store.id,
          product_id: item.product_id,
          batch_id: alloc.batch.id,
          movement_type: 'SALE',
          qty_base: alloc.qty.neg().toString(),
          balance_after: balanceAfter,
          unit_cost_paise: alloc.batch.cost_price_paise ?? 0,
          reference_type: 'ORDER',
          reference_id: order.id,
          occurred_at: now,
          created_at: now,
        });
      }

      subtotal += Number(item.taxable_value_paise);
      taxTotal += Number(item.cgst_paise) + Number(item.sgst_paise) + Number(item.igst_paise);
    }

    const counter = await trx('counters').where({ store_id: store.id }).orderBy('id', 'asc').first();
    const fy = financialYear(now, store.financial_year_start);
    const invoicePrefix = resolveInvoicePrefix(store);
    const invoiceNo = counter ? await nextInvoiceNumberShared(trx, store.id, counter.id, counter.code, invoicePrefix, fy) : `${invoicePrefix}/${fy}/B2B/${order.id}`;

    const [updated] = await trx('b2b_orders')
      .where({ id: order.id })
      .update({ status: 'DELIVERED', delivered_at: now, invoice_no: invoiceNo, updated_at: now })
      .returning('*');

    // A wholesale delivery is a credit sale to the wholesale customer — this
    // was missing entirely (stock decremented and invoiced, but the
    // customer's payable never moved), unlike checkout.service.ts's
    // equivalent credit-sale path, which does post this entry.
    if (updated.customer_id) {
      await postEntry(trx, {
        storeId: store.id,
        customerId: updated.customer_id,
        entryType: 'SALE_CREDIT',
        direction: 'DEBIT',
        amountPaise: Number(updated.total_paise),
        entryDate: businessDate,
        referenceType: 'ORDER',
        referenceId: order.id,
      });
    }

    void subtotal;
    void taxTotal;
    return { order: updated };
  });
}
