import { createHash } from 'node:crypto';
import Decimal from 'decimal.js';
import type { Core } from '@strapi/strapi';
import type { Knex } from 'knex';
import { AppError } from '../../../services/errors';
import { findConversion, toBase, type UnitConversionRow } from '../../../services/units';
import { roundPaise } from '../../../services/pricing';
import { businessDateIso, financialYear } from '../../../services/business-date';
import { strapiRowStamps } from '../../../services/strapi-row';
import { forUpdateSql, rawRows } from '../../../services/sql-dialect';
import { postSupplierEntry } from '../../supplier/services/supplier-ledger';
import { createPurchaseInwardSchema, type CreatePurchaseInwardRequest, type PurchaseInwardItemInput } from './purchase-inward-dto';

declare const strapi: Core.Strapi;

/**
 * REQUIREMENTS.md §3.1 (weighted-average cost on batch top-up) +
 * DATABASE_SCHEMA.md §7.3 + §10.1 (fixed lock order: batches, then
 * suppliers last). Same shape as checkout.service.ts: one Knex
 * transaction, writes bypass the Document Service (Rule BE-2 / ADR-04).
 * "Gatta" (the brief's example unit) isn't a `unit_code` value — it maps
 * to the existing `BORI` code (already means sack/bundle); `toBase()` from
 * src/services/units.ts is reused completely unchanged.
 */

function requestHash(body: unknown): Buffer {
  return createHash('sha256').update(JSON.stringify(body)).digest();
}

async function resolveStore(trx: Knex.Transaction, storeDocumentId: string) {
  const store = await trx('stores').where({ document_id: storeDocumentId }).first();
  if (!store) throw new AppError('ERR_STORE_MISMATCH', 403, `Unknown store ${storeDocumentId}`);
  return store;
}

async function resolveSupplier(trx: Knex.Transaction, storeId: number, supplierDocumentId: string) {
  const supplier = await trx('suppliers').where({ document_id: supplierDocumentId, store_id: storeId }).first();
  if (!supplier) throw new AppError('ERR_STORE_MISMATCH', 403, `Supplier ${supplierDocumentId} does not belong to this store`);
  return supplier;
}

/** Same "System Cashier" stub as checkout.service.ts / shift-lifecycle.ts — no auth system yet. */
async function resolveCreatedBy(trx: Knex.Transaction, tenantId: number) {
  const existing = await trx('app_users').where({ tenant_id: tenantId, full_name: 'System Cashier' }).first();
  if (existing) return existing;
  const [created] = await trx('app_users').insert({ ...strapiRowStamps(), tenant_id: tenantId, full_name: 'System Cashier', is_active: true }).returning('*');
  return created;
}

/** Numbering needs a `counter_id` (invoice_sequences' PK), but a GRN isn't tied to a POS counter — reuses the store's first/default counter purely as a numbering scope, same fallback pattern checkout.service.ts uses for missing context. */
async function resolveNumberingCounter(trx: Knex.Transaction, storeId: number) {
  const existing = await trx('counters').where({ store_id: storeId }).orderBy('id', 'asc').first();
  if (existing) return existing;
  const [created] = await trx('counters').insert({ ...strapiRowStamps(), store_id: storeId, code: 'C1', name: 'Counter 1', is_active: true }).returning('*');
  return created;
}

async function nextGrnNo(trx: Knex.Transaction, storeId: number, counterId: number, fy: string): Promise<string> {
  await trx.raw(
    `INSERT INTO invoice_sequences (store_id, counter_id, financial_year, doc_type, last_value)
     VALUES (?, ?, ?, 'PURCHASE', 0) ON CONFLICT (store_id, counter_id, financial_year, doc_type) DO NOTHING`,
    [storeId, counterId, fy]
  );
  const result = await trx.raw(
    `SELECT last_value FROM invoice_sequences WHERE store_id = ? AND counter_id = ? AND financial_year = ? AND doc_type = 'PURCHASE' ${forUpdateSql(trx)}`,
    [storeId, counterId, fy]
  );
  const rows = rawRows<{ last_value: number }>(result, trx);
  const next = Number(rows[0].last_value) + 1;
  await trx.raw(`UPDATE invoice_sequences SET last_value = ? WHERE store_id = ? AND counter_id = ? AND financial_year = ? AND doc_type = 'PURCHASE'`, [
    next,
    storeId,
    counterId,
    fy,
  ]);
  return `GRN/${fy}/${String(next).padStart(6, '0')}`;
}

interface ResolvedItem {
  raw: PurchaseInwardItemInput;
  product: Record<string, any>;
  conversions: UnitConversionRow[];
  qtyBase: Decimal;
  freeQtyBase: Decimal;
  lineSubtotalPaise: number; // (cost_rate * received_qty) - discount, ex-tax, ex-freight
}

async function resolveItems(trx: Knex.Transaction, storeId: number, items: PurchaseInwardItemInput[]): Promise<ResolvedItem[]> {
  const productIds = Array.from(new Set(items.map((i) => i.product_id)));
  const products = await trx('products').whereIn('document_id', productIds).andWhere({ store_id: storeId });
  const productByDocId = new Map(products.map((p) => [p.document_id, p]));

  const allConversions: UnitConversionRow[] = await trx('unit_conversions').whereIn(
    'product_id',
    products.map((p) => p.id)
  );
  const conversionsByProductId = new Map<number, UnitConversionRow[]>();
  for (const c of allConversions) {
    const list = conversionsByProductId.get(c.product_id) ?? [];
    list.push(c);
    conversionsByProductId.set(c.product_id, list);
  }

  return items.map((raw, index) => {
    const product = productByDocId.get(raw.product_id);
    if (!product) {
      throw new AppError('ERR_STORE_MISMATCH', 403, `Product ${raw.product_id} not found in this store`, { details: { field: `items[${index}]` } });
    }
    const conversions = conversionsByProductId.get(product.id) ?? [];
    const qtyBase = toBase(raw.received_qty, raw.received_unit, conversions);
    const freeQtyBase = raw.free_qty ? toBase(raw.free_qty, raw.received_unit, conversions) : new Decimal(0);

    const gross = new Decimal(raw.cost_rate_paise).mul(raw.received_qty);
    const lineSubtotalPaise = roundPaise(gross.minus(raw.discount_paise ?? 0));
    if (lineSubtotalPaise < 0) {
      throw new AppError('ERR_VALIDATION', 400, `Discount exceeds line value for item ${index}`);
    }

    return { raw, product, conversions, qtyBase, freeQtyBase, lineSubtotalPaise };
  });
}

interface BatchTarget {
  item: ResolvedItem;
  existing: Record<string, any> | null;
}

/** Locates (without locking yet) the batch each item will land in, so all touched ids can be locked in one ascending-id pass (DATABASE_SCHEMA.md §10.1). */
async function planBatchTargets(trx: Knex.Transaction, storeId: number, items: ResolvedItem[]): Promise<BatchTarget[]> {
  const targets: BatchTarget[] = [];
  const candidateIds: number[] = [];

  for (const item of items) {
    const batchNo = item.raw.batch_no ?? 'DEFAULT';
    const expiryDate = item.raw.expiry_date ?? null;
    const existing = await trx('inventory_batches')
      .where({ store_id: storeId, product_id: item.product.id, batch_no: batchNo })
      .andWhere(expiryDate ? { expiry_date: expiryDate } : { expiry_date: null })
      .first();
    if (existing) candidateIds.push(existing.id);
    targets.push({ item, existing: existing ?? null });
  }

  if (candidateIds.length === 0) return targets;

  const locked = await trx('inventory_batches')
    .whereIn('id', Array.from(new Set(candidateIds)).sort((a, b) => a - b))
    .orderBy('id', 'asc')
    .forUpdate();
  const lockedById = new Map(locked.map((b) => [b.id, b]));

  return targets.map((t) => (t.existing ? { item: t.item, existing: lockedById.get(t.existing.id) ?? t.existing } : t));
}

export interface CreatePurchaseInwardContext {
  storeDocumentId: string;
  idempotencyKey: string;
}

export async function createPurchaseInward(rawBody: unknown, ctx: CreatePurchaseInwardContext) {
  const parsed = createPurchaseInwardSchema.safeParse(rawBody);
  if (!parsed.success) {
    throw new AppError('ERR_VALIDATION', 400, parsed.error.issues.map((i) => i.message).join('; '), { details: { issues: parsed.error.issues } });
  }
  const body: CreatePurchaseInwardRequest = parsed.data;
  if (body.client_uuid !== ctx.idempotencyKey) {
    throw new AppError('ERR_VALIDATION', 400, 'Idempotency-Key header must equal client_uuid');
  }

  return strapi.db.connection.transaction(async (trx: Knex.Transaction) => {
    const store = await resolveStore(trx, ctx.storeDocumentId);

    // Idempotency (mirrors checkout.service.ts's claim/complete pair exactly).
    const hash = requestHash(body);
    const insertResult = await trx.raw(
      `INSERT INTO idempotency_keys (key, store_id, route, request_hash, status) VALUES (?, ?, 'POST /api/purchases/inward', ?, 'IN_PROGRESS')
       ON CONFLICT (store_id, key) DO NOTHING RETURNING key`,
      [ctx.idempotencyKey, store.id, hash]
    );
    if (rawRows(insertResult, trx).length === 0) {
      const existing = await trx('idempotency_keys').where({ store_id: store.id, key: ctx.idempotencyKey }).first();
      if (existing && !existing.request_hash.equals(hash)) throw new AppError('IDEMPOTENCY_KEY_REUSED', 422, 'Idempotency-Key reused with a different payload');
      if (existing?.status === 'COMPLETED') {
        const response = typeof existing.response_json === 'string' ? JSON.parse(existing.response_json) : existing.response_json;
        return { response, httpStatus: existing.http_status ?? 201, replay: true };
      }
      if (existing?.status === 'IN_PROGRESS') throw new AppError('ERR_BUSY_RETRY', 409, 'This inward is already being processed');
      await trx('idempotency_keys').where({ store_id: store.id, key: ctx.idempotencyKey }).update({ status: 'IN_PROGRESS' });
    }

    const supplier = await resolveSupplier(trx, store.id, body.supplier_id);
    const createdBy = await resolveCreatedBy(trx, store.tenant_id);
    const resolvedItems = await resolveItems(trx, store.id, body.items);

    const subtotalPaise = resolvedItems.reduce((sum, i) => sum + i.lineSubtotalPaise, 0);
    const freightPaise = body.freight_paise ?? 0;
    const otherChargesPaise = body.other_charges_paise ?? 0;
    const billDiscountPaise = body.bill_discount_paise ?? 0;

    // Freight apportionment: BY_VALUE only (API_CONTRACTS.md §4.1 also allows
    // BY_QTY/NONE — not implemented, documented simplification).
    const freightShares = resolvedItems.map((i) => (subtotalPaise > 0 ? roundPaise(new Decimal(freightPaise).mul(i.lineSubtotalPaise).div(subtotalPaise)) : 0));
    const freightAssigned = freightShares.reduce((s, v) => s + v, 0);
    if (freightShares.length > 0) freightShares[freightShares.length - 1]! += freightPaise - freightAssigned; // residual to the last line

    const targets = await planBatchTargets(trx, store.id, resolvedItems);
    const now = new Date();
    const businessDate = businessDateIso(now);

    let taxTotalPaise = 0;
    const billItemRows: Array<{
      item: ResolvedItem;
      batchId: number;
      batchDocId: string;
      costPerBasePaise: number;
      landedCostPerBasePaise: number;
      taxPaise: number;
      freightShare: number;
      totalInQtyBase: Decimal;
      balanceAfterBatch: string;
    }> = [];

    for (let idx = 0; idx < targets.length; idx += 1) {
      const { item, existing } = targets[idx]!;
      const freightShare = freightShares[idx] ?? 0;
      const gstRate = item.raw.gst_rate ?? Number(item.product.gst_rate);
      const taxPaise = roundPaise(new Decimal(item.lineSubtotalPaise).mul(gstRate).div(100));
      taxTotalPaise += taxPaise;

      const totalInQtyBase = item.qtyBase.plus(item.freeQtyBase); // scheme goods spread the paid cost across paid+free units
      const costPerBasePaise = totalInQtyBase.gt(0) ? roundPaise(new Decimal(item.lineSubtotalPaise).div(totalInQtyBase)) : 0;
      const landedCostPerBasePaise = totalInQtyBase.gt(0) ? roundPaise(new Decimal(item.lineSubtotalPaise).plus(freightShare).div(totalInQtyBase)) : 0;

      let batchId: number;
      let batchDocId: string;
      if (existing) {
        const oldStock = new Decimal(existing.current_stock_base);
        const newStock = oldStock.plus(totalInQtyBase);
        // REQUIREMENTS.md §3.1: new_cost = ROUND((old_stock*old_cost + in_qty*in_cost) / (old_stock+in_qty))
        const newCost = newStock.gt(0)
          ? roundPaise(oldStock.mul(existing.cost_price_paise).plus(totalInQtyBase.mul(costPerBasePaise)).div(newStock))
          : Number(existing.cost_price_paise);
        const newLandedCost = newStock.gt(0)
          ? roundPaise(oldStock.mul(existing.landed_cost_paise).plus(totalInQtyBase.mul(landedCostPerBasePaise)).div(newStock))
          : Number(existing.landed_cost_paise);

        await trx('inventory_batches')
          .where({ id: existing.id })
          .update({
            current_stock_base: newStock.toString(),
            cost_price_paise: newCost,
            landed_cost_paise: newLandedCost,
            mrp_paise: item.raw.mrp_paise ?? existing.mrp_paise,
            selling_price_paise: item.raw.selling_price_paise ?? existing.selling_price_paise,
            updated_at: now,
          });
        batchId = existing.id;
        batchDocId = existing.document_id;
      } else {
        const [created] = await trx('inventory_batches')
          .insert({
            ...strapiRowStamps(),
            store_id: store.id,
            product_id: item.product.id,
            batch_no: item.raw.batch_no ?? 'DEFAULT',
            mfg_date: item.raw.mfg_date ?? null,
            expiry_date: item.raw.expiry_date ?? null,
            cost_price_paise: costPerBasePaise,
            landed_cost_paise: landedCostPerBasePaise,
            mrp_paise: item.raw.mrp_paise ?? null,
            selling_price_paise: item.raw.selling_price_paise ?? null,
            opening_stock_base: totalInQtyBase.toString(),
            current_stock_base: totalInQtyBase.toString(),
            reserved_base: 0,
            received_at: now,
            status: 'ACTIVE',
          })
          .returning('*');
        batchId = created.id;
        batchDocId = created.document_id;
      }

      if (item.raw.update_product_sell_rate && item.raw.selling_price_paise != null) {
        await trx('products').where({ id: item.product.id }).update({ sell_rate_paise: item.raw.selling_price_paise, last_cost_paise: costPerBasePaise, updated_at: now });
      }

      const balanceAfterBatch = existing ? new Decimal(existing.current_stock_base).plus(totalInQtyBase).toString() : totalInQtyBase.toString();
      billItemRows.push({ item, batchId, batchDocId, costPerBasePaise, landedCostPerBasePaise, taxPaise, freightShare, totalInQtyBase, balanceAfterBatch });
    }

    const totalPaise = subtotalPaise - billDiscountPaise + taxTotalPaise + freightPaise + otherChargesPaise + (body.round_off_paise ?? 0);
    if (totalPaise < 0) throw new AppError('ERR_VALIDATION', 400, 'Computed purchase bill total is negative');

    const counter = await resolveNumberingCounter(trx, store.id);
    const fy = financialYear(now, store.financial_year_start);
    const grnNo = await nextGrnNo(trx, store.id, counter.id, fy);

    const paidPaise = body.payment?.amount_paise ?? 0;
    const paymentStatus = paidPaise <= 0 ? 'UNPAID' : paidPaise >= totalPaise ? 'PAID' : 'PARTIALLY_PAID';

    const [bill] = await trx('purchase_bills')
      .insert({
        ...strapiRowStamps(),
        store_id: store.id,
        supplier_id: supplier.id,
        purchase_order_id: null, // resolved below if provided
        grn_no: grnNo,
        supplier_invoice_no: body.supplier_invoice_no ?? null,
        supplier_invoice_date: body.supplier_invoice_date ?? null,
        status: 'POSTED',
        subtotal_paise: subtotalPaise,
        discount_paise: billDiscountPaise,
        tax_paise: taxTotalPaise,
        freight_paise: freightPaise,
        other_charges_paise: otherChargesPaise,
        round_off_paise: body.round_off_paise ?? 0,
        total_paise: totalPaise,
        paid_paise: paidPaise,
        payment_status: paymentStatus,
        due_date: body.due_date ?? null,
        received_at: body.received_at ?? now,
        business_date: businessDate,
      })
      .returning('*');

    // Rule MOV-1: append-only. movement_type 'PURCHASE_IN' is the existing
    // CHECK-constraint value the brief's 'INWARD' maps onto.
    for (const row of billItemRows) {
      await trx('stock_movements').insert({
        store_id: store.id,
        product_id: row.item.product.id,
        batch_id: row.batchId,
        movement_type: 'PURCHASE_IN',
        qty_base: row.totalInQtyBase.toString(),
        balance_after: row.balanceAfterBatch,
        unit_cost_paise: row.landedCostPerBasePaise,
        reference_type: 'PURCHASE_BILL',
        reference_id: bill.id,
        created_by_id: createdBy.id,
        occurred_at: now,
        created_at: now,
      });
    }

    const itemResults = [];
    for (const row of billItemRows) {
      const conv = findConversion(row.item.conversions, row.item.raw.received_unit);
      const [itemRow] = await trx('purchase_bill_items')
        .insert({
          ...strapiRowStamps(),
          store_id: store.id,
          purchase_bill_id: bill.id,
          product_id: row.item.product.id,
          batch_id: row.batchId,
          received_qty: row.item.raw.received_qty,
          received_unit: row.item.raw.received_unit,
          conversion_factor: conv.factor_to_base,
          received_qty_base: row.item.qtyBase.toString(),
          free_qty_base: row.item.freeQtyBase.toString(),
          batch_no: row.item.raw.batch_no ?? 'DEFAULT',
          mfg_date: row.item.raw.mfg_date ?? null,
          expiry_date: row.item.raw.expiry_date ?? null,
          cost_rate_paise: row.item.raw.cost_rate_paise,
          cost_per_base_paise: row.costPerBasePaise,
          discount_paise: row.item.raw.discount_paise ?? 0,
          gst_rate: row.item.raw.gst_rate ?? row.item.product.gst_rate,
          tax_paise: row.taxPaise,
          freight_share_paise: row.freightShare,
          landed_cost_per_base_paise: row.landedCostPerBasePaise,
          mrp_paise: row.item.raw.mrp_paise ?? null,
          selling_price_paise: row.item.raw.selling_price_paise ?? null,
          line_total_paise: row.item.lineSubtotalPaise + row.taxPaise,
        })
        .returning('*');
      itemResults.push({ itemRow, row });
    }

    // Rule: supplier ledger CREDIT = we owe more (§7.4 comment).
    const balanceBefore = Number(supplier.current_balance_paise);
    const ledgerEntry = await postSupplierEntry(trx, {
      storeId: store.id,
      supplierId: supplier.id,
      entryType: 'PURCHASE_BILL',
      direction: 'CREDIT',
      amountPaise: totalPaise,
      entryDate: businessDate,
      referenceType: 'PURCHASE_BILL',
      referenceId: bill.id,
      createdById: createdBy.id,
    });
    let balanceAfter = Number(ledgerEntry.running_balance_paise);

    if (body.payment && paidPaise > 0) {
      const paymentEntry = await postSupplierEntry(trx, {
        storeId: store.id,
        supplierId: supplier.id,
        entryType: 'PAYMENT_MADE',
        direction: 'DEBIT',
        amountPaise: paidPaise,
        entryDate: businessDate,
        referenceType: 'PURCHASE_BILL',
        referenceId: bill.id,
        createdById: createdBy.id,
      });
      balanceAfter = Number(paymentEntry.running_balance_paise);
    }

    const response = {
      purchase_bill: {
        id: bill.document_id,
        grn_no: bill.grn_no,
        status: bill.status,
        subtotal_paise: subtotalPaise,
        tax_paise: taxTotalPaise,
        freight_paise: freightPaise,
        round_off_paise: body.round_off_paise ?? 0,
        total_paise: totalPaise,
        paid_paise: paidPaise,
        payment_status: paymentStatus,
        business_date: businessDate,
      },
      batches: itemResults.map(({ itemRow, row }) => ({
        batch_id: row.batchDocId,
        product_id: row.item.product.document_id,
        batch_no: itemRow.batch_no,
        expiry_date: itemRow.expiry_date ?? undefined,
        qty_in_base: itemRow.received_qty_base,
        cost_per_base_paise: row.costPerBasePaise,
        landed_cost_per_base_paise: row.landedCostPerBasePaise,
        was_existing_batch: Boolean(targets.find((t) => t.item === row.item)?.existing),
      })),
      supplier: { id: supplier.document_id, balance_before_paise: balanceBefore, balance_after_paise: balanceAfter },
    };

    await trx('idempotency_keys')
      .where({ store_id: store.id, key: ctx.idempotencyKey })
      .update({ status: 'COMPLETED', response_json: JSON.stringify(response), http_status: 201, completed_at: now });

    return { response, httpStatus: 201, replay: false };
  });
}
