import Decimal from 'decimal.js';
import type { Core } from '@strapi/strapi';
import type { Knex } from 'knex';
import { AppError } from '../../../services/errors';
import { strapiRowStamps } from '../../../services/strapi-row';
import { writeAuditLog } from '../../../services/audit';

declare const strapi: Core.Strapi;

/**
 * Bulk product import / upsert for Saman & Rates (TASKS_BREAKDOWN.md 13.3).
 *
 * The BFF parses the uploaded .xlsx/.csv into rows of raw cell strings; this
 * service is authoritative for validation and writes. Matching, per row:
 *   1. `sku` (the barcode column) within the session store;
 *   2. otherwise `product_name`, case-insensitive exact match within the store.
 * Matches are updated (name, category, rates, GST, HSN); everything else is
 * inserted with its base-unit conversion (Rule UC-2). `current_stock` is a
 * counted quantity: the difference from current stock is posted as
 * append-only stock movements (Rule MOV-1) — batch history is never
 * overwritten.
 *
 * Each row commits in its own transaction, so one bad row cannot sink the
 * rest of the file; every write is audit-logged in the same transaction as
 * the change (Rule AUD-3).
 */

export const MAX_IMPORT_ROWS = 2000;

// Raw Knex sees Strapi's snake-cased columns: the wholesale_tier1_rate_paise
// attribute is stored as wholesale_tier_1_rate_paise (see b2b-dispatch.ts).
const GST_SLABS = [0, 5, 12, 18, 28];

export interface RawImportRow {
  row_number: number;
  product_name?: string;
  sku?: string;
  category?: string;
  base_unit?: string;
  mrp?: string;
  retail_rate?: string;
  wholesale_tier1_rate?: string;
  wholesale_tier2_rate?: string;
  gst_slab?: string;
  current_stock?: string;
  hsn_code?: string;
}

/**
 * Row errors are codes + params so the UI can render them in the active
 * language (lib/translations `import.err.*`); `message` is the English
 * fallback for API consumers.
 */
export interface ImportRowError {
  code: string;
  params?: Record<string, string | number>;
  message: string;
}

export interface ImportRowResult {
  row_number: number;
  status: 'CREATED' | 'UPDATED' | 'FAILED';
  product_id?: string;
  sku?: string;
  product_name?: string;
  stock_adjusted_base?: string;
  errors?: ImportRowError[];
}

function rowError(code: string, message: string, params?: ImportRowError['params']): ImportRowError {
  return { code, message, ...(params ? { params } : {}) };
}

export interface ImportSummary {
  total_rows: number;
  created: number;
  updated: number;
  failed: number;
  rows: ImportRowResult[];
}

// ---------------------------------------------------------------------------
// Units: the template's unit column -> the product's base unit (DATABASE_SCHEMA
// §3.2 allows only G / ML / PCS) plus the unit its rates are quoted in.
// ---------------------------------------------------------------------------

interface UnitPlan {
  base: 'G' | 'ML' | 'PCS';
  pricing: 'G' | 'KG' | 'ML' | 'L' | 'PCS';
  factor: number; // pricing unit -> base
}

const UNIT_ALIASES: Record<string, UnitPlan> = {
  PCS: { base: 'PCS', pricing: 'PCS', factor: 1 },
  PC: { base: 'PCS', pricing: 'PCS', factor: 1 },
  NOS: { base: 'PCS', pricing: 'PCS', factor: 1 },
  PIECE: { base: 'PCS', pricing: 'PCS', factor: 1 },
  POUCH: { base: 'PCS', pricing: 'PCS', factor: 1 },
  PACKET: { base: 'PCS', pricing: 'PCS', factor: 1 },
  PKT: { base: 'PCS', pricing: 'PCS', factor: 1 },
  G: { base: 'G', pricing: 'G', factor: 1 },
  GM: { base: 'G', pricing: 'G', factor: 1 },
  GRAM: { base: 'G', pricing: 'G', factor: 1 },
  KG: { base: 'G', pricing: 'KG', factor: 1000 },
  KGS: { base: 'G', pricing: 'KG', factor: 1000 },
  ML: { base: 'ML', pricing: 'ML', factor: 1 },
  L: { base: 'ML', pricing: 'L', factor: 1000 },
  LTR: { base: 'ML', pricing: 'L', factor: 1000 },
  LITRE: { base: 'ML', pricing: 'L', factor: 1000 },
};

export const ALLOWED_UNITS_LABEL = 'PCS, POUCH, KG, G, L, ML';

/** Other unit codes (DATABASE_SCHEMA §3.4) — accepted only when they are an existing product's pricing unit. */
const PACK_UNIT_CODES = new Set(['QUINTAL', 'DOZEN', 'PACKET', 'CARTON', 'BORI', 'CRATE']);

// ---------------------------------------------------------------------------
// Row validation (pure)
// ---------------------------------------------------------------------------

interface ValidRow {
  row_number: number;
  name: string;
  sku: string | null;
  category: string | null;
  /** Null for a pack unit (DOZEN, BORI, ...) — valid only for an existing product priced in it. */
  unit: UnitPlan | null;
  /** The unit exactly as written (uppercased), e.g. KG or PACKET. */
  unitCode: string;
  mrpPaise: number | null;
  retailPaise: number;
  tier1Paise: number | null;
  tier2Paise: number | null;
  gstRate: number | null; // null = keep existing (updates) / 0 (inserts)
  stockQty: Decimal | null; // counted stock in `unitCode`, null = leave stock alone
  hsn: string | null;
}

function blank(v: unknown): boolean {
  return v == null || String(v).trim() === '';
}

function parseRupees(label: string, raw: string | undefined, errors: ImportRowError[]): number | null {
  if (blank(raw)) return null;
  const cleaned = String(raw).replace(/[₹,\s]/g, '').replace(/^rs\.?/i, '');
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) {
    errors.push(rowError('RATE_INVALID', `Invalid ${label} '${String(raw).trim()}' — use a number like 125 or 125.50`, { field: label, value: String(raw).trim() }));
    return null;
  }
  return Math.round(Number(cleaned) * 100);
}

export function validateRow(raw: RawImportRow): { row?: ValidRow; errors: ImportRowError[] } {
  const errors: ImportRowError[] = [];
  const name = String(raw.product_name ?? '').trim().replace(/\s+/g, ' ');
  if (!name) errors.push(rowError('NAME_REQUIRED', 'product_name is required'));
  else if (name.length > 255) errors.push(rowError('NAME_TOO_LONG', 'product_name is longer than 255 characters'));

  const sku = blank(raw.sku) ? null : String(raw.sku).trim();
  if (sku && (sku.length > 40 || /\s/.test(sku))) errors.push(rowError('SKU_INVALID', `Invalid barcode/sku '${sku}' — max 40 characters, no spaces`, { value: sku }));

  const unitKey = String(raw.base_unit ?? '').trim().toUpperCase().replace(/\.$/, '');
  const unit = UNIT_ALIASES[unitKey];
  if (!unitKey) errors.push(rowError('UNIT_REQUIRED', 'base_unit is required'));
  else if (!unit && !PACK_UNIT_CODES.has(unitKey))
    errors.push(rowError('UNIT_INVALID', `Invalid base_unit '${String(raw.base_unit).trim()}' — allowed: ${ALLOWED_UNITS_LABEL}`, { value: String(raw.base_unit).trim(), allowed: ALLOWED_UNITS_LABEL }));

  const retailPaise = parseRupees('retail_rate', raw.retail_rate, errors);
  if (blank(raw.retail_rate)) errors.push(rowError('RETAIL_REQUIRED', 'retail_rate is required'));
  const mrpPaise = parseRupees('mrp', raw.mrp, errors);
  const tier1Paise = parseRupees('wholesale_tier1_rate', raw.wholesale_tier1_rate, errors);
  const tier2Paise = parseRupees('wholesale_tier2_rate', raw.wholesale_tier2_rate, errors);
  // Selling above MRP is refused at the counter (ERR_PRICE_ABOVE_MRP), so catch it here.
  if (mrpPaise != null) {
    for (const [label, paise] of [['retail_rate', retailPaise], ['wholesale_tier1_rate', tier1Paise], ['wholesale_tier2_rate', tier2Paise]] as const) {
      if (paise != null && paise > mrpPaise) {
        const rate = (paise / 100).toFixed(2);
        const mrp = (mrpPaise / 100).toFixed(2);
        errors.push(rowError('RATE_ABOVE_MRP', `${label} ₹${rate} is above MRP ₹${mrp}`, { field: label, rate, mrp }));
      }
    }
  }

  let gstRate: number | null = null;
  if (!blank(raw.gst_slab)) {
    const cleaned = String(raw.gst_slab).trim().replace(/%$/, '').trim();
    const n = Number(cleaned);
    if (cleaned === '' || !Number.isFinite(n) || !GST_SLABS.includes(n)) {
      errors.push(rowError('GST_INVALID', `Invalid GST rate '${String(raw.gst_slab).trim()}' — must be 0, 5, 12, 18 or 28`, { value: String(raw.gst_slab).trim() }));
    } else gstRate = n;
  }

  let stockQty: Decimal | null = null;
  if (!blank(raw.current_stock)) {
    const cleaned = String(raw.current_stock).replace(/[,\s]/g, '');
    if (!/^\d+(\.\d{1,3})?$/.test(cleaned)) {
      errors.push(rowError('STOCK_INVALID', `Invalid current_stock '${String(raw.current_stock).trim()}' — use a non-negative number (max 3 decimals)`, { value: String(raw.current_stock).trim() }));
    } else stockQty = new Decimal(cleaned);
  }

  const hsn = blank(raw.hsn_code) ? null : String(raw.hsn_code).trim();
  if (hsn && !/^\d{2,8}$/.test(hsn)) errors.push(rowError('HSN_INVALID', `Invalid hsn_code '${hsn}' — 2 to 8 digits`, { value: hsn }));

  const category = blank(raw.category) ? null : String(raw.category).trim().replace(/\s+/g, ' ').slice(0, 120);

  if (errors.length || retailPaise == null) return { errors };
  return { row: { row_number: raw.row_number, name, sku, category, unit: unit ?? null, unitCode: unitKey, mrpPaise, retailPaise, tier1Paise, tier2Paise, gstRate, stockQty, hsn }, errors };
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

interface ImportContext {
  storeDocumentId: string;
  userDocumentId?: string;
  traceId?: string;
}

function slugSku(name: string): string {
  const base = name.toUpperCase().replace(/[^A-Z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 28) || 'ITEM';
  return `IMP-${base}`;
}

async function uniqueSku(trx: Knex.Transaction, storeId: number, name: string): Promise<string> {
  const base = slugSku(name);
  for (let i = 0; i < 1000; i++) {
    const candidate = i === 0 ? base : `${base}-${i + 1}`;
    if (!(await trx('products').where({ store_id: storeId, sku: candidate }).first())) return candidate;
  }
  throw new AppError('ERR_VALIDATION', 422, 'Could not generate a unique sku');
}

async function resolveCategory(trx: Knex.Transaction, storeId: number, name: string | null): Promise<number | null> {
  if (!name) return null;
  const existing = await trx('categories').where({ store_id: storeId }).whereRaw('LOWER(name) = ?', [name.toLowerCase()]).first();
  if (existing) return existing.id;
  const [created] = await trx('categories').insert({ ...strapiRowStamps(), store_id: storeId, name, sort_order: 0, is_active: true }).returning('*');
  return created.id;
}

async function ensureConversion(trx: Knex.Transaction, storeId: number, productId: number, unitCode: string, factor: number, sortOrder: number) {
  const existing = await trx('unit_conversions').where({ product_id: productId, unit_code: unitCode }).first();
  if (existing) return;
  await trx('unit_conversions').insert({
    ...strapiRowStamps(),
    store_id: storeId,
    product_id: productId,
    unit_code: unitCode,
    factor_to_base: factor,
    is_sale_unit: true,
    is_purchase_unit: true,
    sort_order: sortOrder,
  });
}

/**
 * Brings the product's ACTIVE stock to `targetBase` with ADJUSTMENT_IN /
 * ADJUSTMENT_OUT (or OPENING for a brand-new product) movements. Increases
 * go to the DEFAULT (no-expiry) batch; decreases draw down batches FEFO.
 * Returns the net change posted.
 */
async function adjustStockTo(
  trx: Knex.Transaction,
  ctx: { storeId: number; productId: number; actorId: number | null; isNew: boolean; costPaise: number },
  targetBase: Decimal
): Promise<Decimal> {
  const batches = await trx('inventory_batches')
    .where({ store_id: ctx.storeId, product_id: ctx.productId, status: 'ACTIVE' })
    .orderByRaw('CASE WHEN expiry_date IS NULL THEN 1 ELSE 0 END, expiry_date, received_at, id');
  const current = batches.reduce((sum: Decimal, b: any) => sum.plus(b.current_stock_base), new Decimal(0));
  const delta = targetBase.minus(current);
  if (delta.isZero()) return delta;

  const now = new Date();
  const movement = (batchId: number, type: string, qty: Decimal, balanceAfter: Decimal) =>
    trx('stock_movements').insert({
      store_id: ctx.storeId,
      product_id: ctx.productId,
      batch_id: batchId,
      movement_type: type,
      qty_base: qty.toString(),
      balance_after: balanceAfter.toString(),
      unit_cost_paise: ctx.costPaise,
      reference_type: ctx.isNew ? 'SYSTEM' : 'ADJUSTMENT',
      reference_id: null,
      reason_code: 'BULK_IMPORT',
      note: ctx.isNew ? 'Opening stock from bulk import' : 'Stock count from bulk import',
      created_by_id: ctx.actorId,
      occurred_at: now,
      created_at: now,
    });

  if (delta.gt(0)) {
    let batch = batches.find((b: any) => b.batch_no === 'DEFAULT' && b.expiry_date == null);
    if (batch) {
      const balance = new Decimal(batch.current_stock_base).plus(delta);
      await trx('inventory_batches').where({ id: batch.id }).update({ current_stock_base: balance.toString(), updated_at: now });
      await movement(batch.id, 'ADJUSTMENT_IN', delta, balance);
    } else {
      [batch] = await trx('inventory_batches')
        .insert({
          ...strapiRowStamps(),
          store_id: ctx.storeId,
          product_id: ctx.productId,
          batch_no: 'DEFAULT',
          cost_price_paise: ctx.costPaise,
          landed_cost_paise: ctx.costPaise,
          opening_stock_base: delta.toString(),
          current_stock_base: delta.toString(),
          reserved_base: 0,
          received_at: now,
          status: 'ACTIVE',
        })
        .returning('*');
      await movement(batch.id, ctx.isNew ? 'OPENING' : 'ADJUSTMENT_IN', delta, delta);
    }
    return delta;
  }

  // Decrease: FEFO across batches holding stock, then any remainder from the
  // DEFAULT batch (only reachable if stock was already inconsistent).
  let remaining = delta.abs();
  for (const b of batches) {
    if (remaining.isZero()) break;
    const available = new Decimal(b.current_stock_base);
    if (available.lte(0)) continue;
    const take = Decimal.min(available, remaining);
    const balance = available.minus(take);
    await trx('inventory_batches').where({ id: b.id }).update({ current_stock_base: balance.toString(), updated_at: now });
    await movement(b.id, 'ADJUSTMENT_OUT', take.negated(), balance);
    remaining = remaining.minus(take);
  }
  if (remaining.gt(0) && batches.length) {
    const b = batches[batches.length - 1];
    const fresh = await trx('inventory_batches').where({ id: b.id }).first();
    const balance = new Decimal(fresh.current_stock_base).minus(remaining);
    await trx('inventory_batches').where({ id: b.id }).update({ current_stock_base: balance.toString(), updated_at: now });
    await movement(b.id, 'ADJUSTMENT_OUT', remaining.negated(), balance);
  }
  return delta;
}

async function findMatch(
  trx: Knex.Transaction,
  storeId: number,
  row: ValidRow
): Promise<{ product: any; by: 'sku' | 'name' } | { error: ImportRowError } | null> {
  if (row.sku) {
    const bySku = await trx('products').where({ store_id: storeId, sku: row.sku }).first();
    if (bySku) return { product: bySku, by: 'sku' };
  }
  const byName = await trx('products').where({ store_id: storeId }).whereRaw('LOWER(name) = ?', [row.name.toLowerCase()]).limit(2);
  if (byName.length > 1) {
    return { error: rowError('NAME_AMBIGUOUS', `product_name '${row.name}' matches more than one product — add the barcode/sku to pick one`, { name: row.name }) };
  }
  if (byName.length === 1) return { product: byName[0], by: 'name' };
  return null;
}

async function upsertRow(store: any, actorId: number | null, row: ValidRow, traceId?: string): Promise<ImportRowResult> {
  return strapi.db.connection.transaction(async (trx: Knex.Transaction): Promise<ImportRowResult> => {
    const match = await findMatch(trx, store.id, row);
    if (match && 'error' in match) return { row_number: row.row_number, status: 'FAILED', product_name: row.name, errors: [match.error] };
    const now = new Date();
    const categoryId = await resolveCategory(trx, store.id, row.category);

    if (match) {
      const p = match.product;
      const fail = (error: ImportRowError): ImportRowResult => ({ row_number: row.row_number, status: 'FAILED', product_name: row.name, sku: p.sku, errors: [error] });
      // Rates are quoted per the product's pricing unit. The row may name that
      // unit directly (e.g. PACKET for a 10 kg atta pack); otherwise its unit
      // must mean the same base and pricing unit — silently switching KG <-> G
      // (or PACKET -> KG) would reinterpret every rate.
      const unitInvalid = () =>
        fail(rowError('UNIT_INVALID', `Invalid base_unit '${row.unitCode}' — allowed: ${ALLOWED_UNITS_LABEL}`, { value: row.unitCode, allowed: ALLOWED_UNITS_LABEL }));
      if (row.unitCode !== p.pricing_unit) {
        if (!row.unit) return unitInvalid();
        if (p.base_unit !== row.unit.base) {
          return fail(rowError('BASE_UNIT_CHANGE', `base_unit cannot change from ${p.base_unit} to ${row.unit.base} for an existing product`, { from: p.base_unit, to: row.unit.base }));
        }
        if (p.pricing_unit !== row.unit.pricing) {
          return fail(
            rowError('PRICING_UNIT_CHANGE', `Rates for this product are per ${p.pricing_unit}; the file gives them per ${row.unit.pricing}`, { from: p.pricing_unit, to: row.unit.pricing })
          );
        }
      }
      const pricingConv = await trx('unit_conversions').where({ product_id: p.id, unit_code: p.pricing_unit }).first();
      const factor = new Decimal(pricingConv?.factor_to_base ?? (p.pricing_unit === p.base_unit ? 1 : row.unit?.factor ?? 1));
      const stockBase = row.stockQty ? row.stockQty.mul(factor) : null;
      if (stockBase && p.base_unit === 'PCS' && !stockBase.isInteger()) {
        return fail(rowError('STOCK_NOT_WHOLE', `current_stock for ${p.pricing_unit} must be a whole number`, { unit: p.pricing_unit }));
      }
      if (row.sku && p.sku !== row.sku) {
        const clash = await trx('products').where({ store_id: store.id, sku: row.sku }).whereNot({ id: p.id }).first();
        if (clash) {
          return {
            row_number: row.row_number,
            status: 'FAILED',
            product_name: row.name,
            errors: [rowError('SKU_TAKEN', `barcode/sku '${row.sku}' already belongs to '${clash.name}'`, { sku: row.sku, other: clash.name })],
          };
        }
      }
      const before = {
        name: p.name,
        mrp_paise: p.mrp_paise,
        sell_rate_paise: p.sell_rate_paise,
        wholesale_tier_1_rate_paise: p.wholesale_tier_1_rate_paise,
        wholesale_tier_2_rate_paise: p.wholesale_tier_2_rate_paise,
        gst_rate: p.gst_rate,
        hsn_code: p.hsn_code,
      };
      // A barcode match may rename the product; a name match only differs in
      // case/spacing, so the stored name is kept as it is.
      const name = match.by === 'sku' ? row.name : p.name;
      const changes: Record<string, unknown> = {
        name,
        search_text: [name, p.name_local, p.sku].filter(Boolean).join(' '),
        sell_rate_paise: row.retailPaise,
        updated_at: now,
      };
      // Blank optional cells mean "leave as is" for an existing product.
      if (row.mrpPaise != null) changes.mrp_paise = row.mrpPaise;
      if (row.tier1Paise != null) changes.wholesale_tier_1_rate_paise = row.tier1Paise;
      if (row.tier2Paise != null) changes.wholesale_tier_2_rate_paise = row.tier2Paise;
      if (row.gstRate != null) changes.gst_rate = row.gstRate;
      if (row.hsn != null) changes.hsn_code = row.hsn;
      if (categoryId != null) changes.category_id = categoryId;
      await trx('products').where({ id: p.id }).update(changes);

      const stockDelta = stockBase
        ? await adjustStockTo(trx, { storeId: store.id, productId: p.id, actorId, isNew: false, costPaise: Number(p.last_cost_paise ?? 0) }, stockBase)
        : null;
      await writeAuditLog(trx, {
        store_id: store.id,
        actor_user_id: actorId,
        action: 'PRODUCT_IMPORT_UPDATE',
        entity_type: 'product',
        entity_id: p.id,
        before_json: before,
        after_json: { ...changes, updated_at: undefined, stock_delta_base: stockDelta?.toString() ?? null },
        reason_code: 'BULK_IMPORT',
        trace_id: traceId,
      });
      return {
        row_number: row.row_number,
        status: 'UPDATED',
        product_id: p.document_id,
        sku: p.sku,
        product_name: name,
        stock_adjusted_base: stockDelta?.toString(),
      };
    }

    const plan = row.unit;
    if (!plan) {
      return {
        row_number: row.row_number,
        status: 'FAILED',
        product_name: row.name,
        errors: [rowError('UNIT_INVALID', `Invalid base_unit '${row.unitCode}' — allowed: ${ALLOWED_UNITS_LABEL}`, { value: row.unitCode, allowed: ALLOWED_UNITS_LABEL })],
      };
    }
    const newStockBase = row.stockQty ? row.stockQty.mul(plan.factor) : null;
    if (newStockBase && plan.base === 'PCS' && !newStockBase.isInteger()) {
      return {
        row_number: row.row_number,
        status: 'FAILED',
        product_name: row.name,
        errors: [rowError('STOCK_NOT_WHOLE', `current_stock for ${row.unitCode} must be a whole number`, { unit: row.unitCode })],
      };
    }
    const sku = row.sku ?? (await uniqueSku(trx, store.id, row.name));
    const [product] = await trx('products')
      .insert({
        ...strapiRowStamps(),
        store_id: store.id,
        category_id: categoryId,
        sku,
        name: row.name,
        search_text: [row.name, sku].join(' '),
        hsn_code: row.hsn,
        base_unit: plan.base,
        is_service: false,
        allow_fractional: plan.base !== 'PCS',
        // Loose goods priced per KG/L are entered as e.g. 1.25 KG (Rule UC-5).
        quantity_precision: plan.base === 'PCS' ? 0 : 3,
        default_sale_unit: plan.pricing,
        default_purchase_unit: plan.pricing,
        pricing_unit: plan.pricing,
        requires_quantity_prompt: false,
        mrp_paise: row.mrpPaise,
        sell_rate_paise: row.retailPaise,
        wholesale_tier_1_rate_paise: row.tier1Paise,
        wholesale_tier_2_rate_paise: row.tier2Paise,
        gst_rate: row.gstRate ?? 0,
        cess_rate: 0,
        tax_inclusive: true,
        discount_exempt: false,
        track_batches: false,
        track_expiry: false,
        sales_rank: 0,
        is_active: true,
      })
      .returning('*');
    // Rule UC-2: the base-unit anchor (factor 1). Raw inserts skip the product lifecycle hook that normally adds it.
    await ensureConversion(trx, store.id, product.id, plan.base, 1, 0);
    if (plan.pricing !== plan.base) await ensureConversion(trx, store.id, product.id, plan.pricing, plan.factor, 1);

    const stockDelta =
      newStockBase && newStockBase.gt(0)
        ? await adjustStockTo(trx, { storeId: store.id, productId: product.id, actorId, isNew: true, costPaise: 0 }, newStockBase)
        : null;
    await writeAuditLog(trx, {
      store_id: store.id,
      actor_user_id: actorId,
      action: 'PRODUCT_IMPORT_CREATE',
      entity_type: 'product',
      entity_id: product.id,
      after_json: { sku, name: row.name, sell_rate_paise: row.retailPaise, mrp_paise: row.mrpPaise, gst_rate: row.gstRate ?? 0, opening_stock_base: stockDelta?.toString() ?? '0' },
      reason_code: 'BULK_IMPORT',
      trace_id: traceId,
    });
    return {
      row_number: row.row_number,
      status: 'CREATED',
      product_id: product.document_id,
      sku,
      product_name: row.name,
      stock_adjusted_base: stockDelta?.toString(),
    };
  });
}

export async function importProducts(rawRows: unknown, ctx: ImportContext): Promise<ImportSummary> {
  if (!Array.isArray(rawRows)) throw new AppError('ERR_VALIDATION', 400, 'rows must be an array');
  if (rawRows.length === 0) throw new AppError('ERR_VALIDATION', 400, 'The file has no product rows');
  if (rawRows.length > MAX_IMPORT_ROWS) throw new AppError('ERR_VALIDATION', 400, `At most ${MAX_IMPORT_ROWS} rows per upload`);

  const knex = strapi.db.connection;
  const store = await knex('stores').where({ document_id: ctx.storeDocumentId }).first();
  if (!store) throw new AppError('ERR_STORE_MISMATCH', 403, `Unknown store ${ctx.storeDocumentId}`);
  const actor = ctx.userDocumentId
    ? await knex('app_users').where({ document_id: ctx.userDocumentId, tenant_id: store.tenant_id }).first()
    : null;
  const actorId: number | null = actor?.id ?? null;

  const results: ImportRowResult[] = [];
  // Within one file, the same barcode or name twice would update the same product twice — flag the later row.
  const seenSku = new Map<string, number>();
  const seenName = new Map<string, number>();

  for (const raw of rawRows as RawImportRow[]) {
    const rowNumber = Number(raw?.row_number) || results.length + 2;
    const { row, errors } = validateRow({ ...raw, row_number: rowNumber });
    if (!row) {
      results.push({ row_number: rowNumber, status: 'FAILED', product_name: raw?.product_name?.trim() || undefined, errors });
      continue;
    }
    const skuKey = row.sku?.toUpperCase();
    const nameKey = row.name.toLowerCase();
    const dupOf = (skuKey && seenSku.get(skuKey)) || seenName.get(nameKey);
    if (dupOf) {
      results.push({ row_number: rowNumber, status: 'FAILED', product_name: row.name, errors: [rowError('DUPLICATE_ROW', `Duplicate of row ${dupOf} in this file`, { row: dupOf })] });
      continue;
    }
    if (skuKey) seenSku.set(skuKey, rowNumber);
    seenName.set(nameKey, rowNumber);

    try {
      results.push(await upsertRow(store, actorId, row, ctx.traceId));
    } catch (err) {
      strapi.log.error(`product import row ${rowNumber} failed`, err as Error);
      const message = err instanceof AppError ? err.message : 'Could not save this row';
      results.push({ row_number: rowNumber, status: 'FAILED', product_name: row.name, errors: [rowError('SAVE_FAILED', message)] });
    }
  }

  return {
    total_rows: results.length,
    created: results.filter((r) => r.status === 'CREATED').length,
    updated: results.filter((r) => r.status === 'UPDATED').length,
    failed: results.filter((r) => r.status === 'FAILED').length,
    rows: results,
  };
}
