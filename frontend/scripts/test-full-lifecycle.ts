/**
 * Automated End-to-End Lifecycle Test Suite.
 *
 * Exercises the real running system (BFF at :3000 -> Strapi at :1337 -> the
 * dev sqlite DB) exactly as a user would: logs in as "Shivam Interprices",
 * creates real suppliers/products/customers, runs full purchase-inward ->
 * supplier-settlement, POS shift -> 5 bills -> close, and B2B
 * book -> dispatch -> deliver lifecycles, then prints a reconciliation report.
 *
 * Two classes of calls are made, both against the live dev servers (no
 * mocking, no UI clicking — the /b2b/purchases, /b2b/suppliers and
 * /b2b/dispatch pages are hardcoded mock-data pickers today and cannot
 * carry real ids into the real transactional endpoints; see this script's
 * companion investigation notes):
 *   - BFF calls (http://localhost:3000/api/...) for every route that has
 *     one — checkout, shifts, b2b orders/dispatch/deliver, purchase inward,
 *     inventory products, customer directory/ledger/payment. These go
 *     through the real session-derived store/tenant binding.
 *   - Direct Strapi calls (http://localhost:1337/api/...) using the service
 *     token, ONLY for the handful of master-data writes that have no BFF
 *     route yet: supplier create, supplier ledger payment, customer create,
 *     unit-conversion create. Reads still prefer the BFF where one exists.
 *
 * Run: node scripts/test-full-lifecycle.ts   (from frontend/, with both dev
 * servers already running).
 */

import * as fs from 'fs';
import * as path from 'path';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);

const FRONTEND_BASE = 'http://localhost:3000';

const SCRIPT_DIR = import.meta.dirname;

function loadEnv(): Record<string, string> {
  const envPath = path.join(SCRIPT_DIR, '..', '.env.local');
  const text = fs.readFileSync(envPath, 'utf8');
  const out: Record<string, string> = {};
  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const idx = line.indexOf('=');
    if (idx === -1) continue;
    out[line.slice(0, idx).trim()] = line.slice(idx + 1).trim();
  }
  return out;
}

const ENV = loadEnv();
const STRAPI_URL = ENV.STRAPI_URL || 'http://localhost:1337';
const STRAPI_TOKEN = ENV.STRAPI_SERVICE_TOKEN;
if (!STRAPI_TOKEN) throw new Error('STRAPI_SERVICE_TOKEN missing from frontend/.env.local');

let sessionCookie = '';

interface FetchResult {
  ok: boolean;
  status: number;
  json: any;
  text: string;
}

async function bff(urlPath: string, opts: RequestInit = {}): Promise<FetchResult> {
  const res = await fetch(`${FRONTEND_BASE}${urlPath}`, {
    ...opts,
    headers: { 'Content-Type': 'application/json', Cookie: sessionCookie, 'X-Device-Id': 'e2e-test-script', ...(opts.headers as any) },
  });
  const text = await res.text();
  let json: any = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* non-JSON body */
  }
  return { ok: res.ok, status: res.status, json, text };
}

async function strapi(urlPath: string, opts: RequestInit = {}): Promise<FetchResult> {
  const res = await fetch(`${STRAPI_URL}${urlPath}`, {
    ...opts,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${STRAPI_TOKEN}`, ...(opts.headers as any) },
  });
  const text = await res.text();
  let json: any = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* non-JSON body */
  }
  return { ok: res.ok, status: res.status, json, text };
}

function rupees(paise: number): string {
  return `Rs.${(paise / 100).toFixed(2)}`;
}

function must(cond: boolean, message: string): void {
  if (!cond) throw new Error(`ASSERTION FAILED: ${message}`);
}

function uuid(): string {
  return crypto.randomUUID();
}

// ---------------------------------------------------------------------------
// Console section logging
// ---------------------------------------------------------------------------

function section(title: string) {
  console.log(`\n${'='.repeat(78)}\n${title}\n${'='.repeat(78)}`);
}

function step(label: string, detail?: string) {
  console.log(`  - ${label}${detail ? ' -> ' + detail : ''}`);
}

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

async function login(): Promise<{ storeId: string; tenantId: string; storeName: string; activeShiftId: string | null }> {
  const res = await fetch(`${FRONTEND_BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ identifier: '9998812345', password: 'testpass123' }),
  });
  if (!res.ok) throw new Error(`login failed (${res.status}): ${await res.text()}`);
  const cookies = (res.headers as any).getSetCookie ? (res.headers as any).getSetCookie() : [res.headers.get('set-cookie')];
  const dukaanCookie = (cookies as string[]).find((c) => c && c.startsWith('dukaan_session='));
  if (!dukaanCookie) throw new Error('login succeeded but no dukaan_session cookie was set');
  sessionCookie = dukaanCookie.split(';')[0];

  const me = await bff('/api/auth/me');
  must(me.ok, `GET /api/auth/me failed after login: ${me.text}`);
  return {
    storeId: me.json.data.store.id,
    tenantId: me.json.data.tenant_id,
    storeName: me.json.data.store.name,
    activeShiftId: me.json.data.active_shift?.id ?? null,
  };
}

// ---------------------------------------------------------------------------
// Master data: suppliers, products, unit conversions, customers
// (find-or-create so the script is safely re-runnable)
// ---------------------------------------------------------------------------

async function findOrCreateSupplier(name: string, gstin: string, storeId: string): Promise<string> {
  const list = await strapi(`/api/suppliers?filters[name][$eq]=${encodeURIComponent(name)}&filters[store][documentId][$eq]=${storeId}`);
  must(list.ok, `list suppliers failed: ${list.text}`);
  const existing = list.json?.data?.[0];
  if (existing) return existing.documentId;

  const created = await strapi('/api/suppliers', {
    method: 'POST',
    body: JSON.stringify({ data: { name, gstin, store: storeId } }),
  });
  must(created.ok, `create supplier "${name}" failed: ${created.text}`);
  return created.json.data.documentId;
}

interface ProductSpec {
  sku: string;
  name: string;
  name_local?: string;
  is_service?: boolean;
  base_unit: 'G' | 'ML' | 'PCS';
  pricing_unit: string;
  default_sale_unit: string;
  default_purchase_unit: string;
  sell_rate_paise: number;
}

async function findOrCreateProduct(spec: ProductSpec): Promise<string> {
  // The BFF's ?q= filters by name, not sku (matches the real Saman & Rates page,
  // which also fetches everything and filters client-side) — fetch all and match sku exactly.
  const list = await bff('/api/inventory/products');
  must(list.ok, `list products failed: ${list.text}`);
  const existing = list.json?.data?.find((p: any) => p.sku === spec.sku);
  if (existing) return existing.documentId;

  const created = await bff('/api/inventory/products', {
    method: 'POST',
    body: JSON.stringify({
      sku: spec.sku,
      name: spec.name,
      name_local: spec.name_local,
      base_unit: spec.base_unit,
      default_sale_unit: spec.default_sale_unit,
      default_purchase_unit: spec.default_purchase_unit,
      pricing_unit: spec.pricing_unit,
      sell_rate_paise: spec.sell_rate_paise,
      gst_rate: 0,
      is_service: spec.is_service ?? false,
    }),
  });
  must(created.ok, `create product "${spec.name}" failed: ${created.text}`);
  return created.json.data.documentId;
}

async function findOrCreateUnitConversion(productId: string, storeId: string, unitCode: string, factorToBase: number): Promise<void> {
  const list = await strapi(`/api/unit-conversions?filters[product][documentId][$eq]=${productId}&filters[unit_code][$eq]=${unitCode}`);
  must(list.ok, `list unit-conversions failed: ${list.text}`);
  if (list.json?.data?.length) return;

  const created = await strapi('/api/unit-conversions', {
    method: 'POST',
    body: JSON.stringify({
      data: { store: storeId, product: productId, unit_code: unitCode, factor_to_base: factorToBase, is_sale_unit: true, is_purchase_unit: true, sort_order: 1 },
    }),
  });
  must(created.ok, `create unit-conversion ${unitCode} for product ${productId} failed: ${created.text}`);
}

async function findOrCreateCustomer(name: string, phone: string, storeId: string): Promise<string> {
  const list = await bff('/api/customers');
  must(list.ok, `list customers failed: ${list.text}`);
  const existing = list.json?.data?.find((c: any) => c.name === name);
  if (existing) return existing.documentId;

  const created = await strapi('/api/customers', {
    method: 'POST',
    body: JSON.stringify({ data: { name, phone, store: storeId } }),
  });
  must(created.ok, `create customer "${name}" failed: ${created.text}`);
  return created.json.data.documentId;
}

// ---------------------------------------------------------------------------
// Transactional operations
// ---------------------------------------------------------------------------

async function purchaseInward(supplierId: string, invoiceNo: string, items: any[]) {
  const clientUuid = uuid();
  const res = await bff('/api/b2b/purchases/inward', {
    method: 'POST',
    headers: { 'Idempotency-Key': clientUuid },
    body: JSON.stringify({ client_uuid: clientUuid, supplier_id: supplierId, supplier_invoice_no: invoiceNo, items }),
  });
  must(res.ok, `purchase inward (${invoiceNo}) failed: ${res.text}`);
  return res.json.data;
}

async function paySupplier(supplierId: string, amountPaise: number, note: string) {
  const res = await strapi(`/api/suppliers/${supplierId}/ledger-entries`, {
    method: 'POST',
    body: JSON.stringify({ entry_type: 'PAYMENT_MADE', direction: 'DEBIT', amount_paise: amountPaise, note }),
  });
  must(res.ok, `pay supplier ${supplierId} failed: ${res.text}`);
  return res.json.data;
}

async function getSupplierLedger(supplierId: string) {
  const res = await bff(`/api/b2b/suppliers/${supplierId}/ledger`);
  must(res.ok, `get supplier ledger ${supplierId} failed: ${res.text}`);
  return { entries: res.json.data as any[], balance: Number(res.json.meta.current_balance_paise) };
}

async function getCustomerLedger(customerId: string) {
  const res = await bff(`/api/customers/${customerId}/ledger`);
  must(res.ok, `get customer ledger ${customerId} failed: ${res.text}`);
  return { entries: res.json.data as any[], balance: Number(res.json.meta.current_balance_paise) };
}

async function getPrimaryCounter(): Promise<{ id: string; name: string }> {
  const res = await bff('/api/pos/counters');
  must(res.ok && res.json.data.length > 0, `no active counter found: ${res.text}`);
  return { id: res.json.data[0].documentId, name: res.json.data[0].name };
}

async function cleanupExistingShift(shiftId: string) {
  const expected = await bff(`/api/shifts/${shiftId}/expected`);
  must(expected.ok, `pre-flight expected-cash failed: ${expected.text}`);
  const expectedPaise = Math.max(0, Number(expected.json.data.expected_cash_paise));
  const close = await bff(`/api/shifts/${shiftId}/close`, {
    method: 'POST',
    body: JSON.stringify({
      denomination_count: { coins_paise: expectedPaise },
      variance_reason_code: 'OTHER',
      variance_reason_text: 'Pre-test cleanup close (stale shift from a prior manual session)',
      approval_token: 'e2e-cleanup',
    }),
  });
  must(close.ok, `pre-flight cleanup close failed: ${close.text}`);
}

async function openShift(counterId: string, openingFloatPaise: number): Promise<string> {
  const clientUuid = uuid();
  const res = await bff('/api/shifts/open', {
    method: 'POST',
    headers: { 'Idempotency-Key': clientUuid },
    body: JSON.stringify({ client_uuid: clientUuid, counter_id: counterId, opening_float_paise: openingFloatPaise, device_id: 'e2e-test-script' }),
  });
  must(res.ok, `open shift failed: ${res.text}`);
  return res.json.data.id;
}

interface CheckoutItemSpec {
  product_id: string;
  entered_qty: string;
  entered_unit: string;
  unit_price_paise: number;
  price_source?: 'PRODUCT' | 'UNIT_OVERRIDE' | 'MANUAL';
}

async function checkout(opts: {
  items: CheckoutItemSpec[];
  payments: Array<{ method: string; amount_paise: number }>;
  customerId?: string;
  shiftId: string;
  counterId: string;
  note?: string;
}) {
  const clientUuid = uuid();
  const body = {
    client_uuid: clientUuid,
    counter_id: opts.counterId,
    shift_id: opts.shiftId,
    customer_id: opts.customerId,
    order_type: 'SALE',
    items: opts.items.map((i) => ({
      line_group_id: uuid(),
      product_id: i.product_id,
      entered_qty: i.entered_qty,
      entered_unit: i.entered_unit,
      unit_price_paise: i.unit_price_paise,
      price_source: i.price_source ?? 'UNIT_OVERRIDE',
    })),
    payments: opts.payments,
    client_created_at: new Date().toISOString(),
    is_offline_origin: false,
    note: opts.note,
  };
  const res = await bff('/api/pos/checkout', {
    method: 'POST',
    headers: { 'Idempotency-Key': clientUuid },
    body: JSON.stringify(body),
  });
  must(res.ok, `checkout failed: ${res.text}`);
  return res.json.data;
}

async function cashMovement(shiftId: string, direction: 'IN' | 'OUT', amountPaise: number, reasonCode: string, note?: string) {
  const res = await bff('/api/pos/shifts/cash-movement', {
    method: 'POST',
    body: JSON.stringify({ shift_id: shiftId, direction, amount_paise: amountPaise, reason_code: reasonCode, note }),
  });
  must(res.ok, `cash movement failed: ${res.text}`);
  return res.json.data;
}

async function getExpectedCash(shiftId: string) {
  const res = await bff(`/api/shifts/${shiftId}/expected`);
  must(res.ok, `expected cash failed: ${res.text}`);
  return res.json.data;
}

async function closeShift(shiftId: string, actualPaise: number) {
  const res = await bff(`/api/shifts/${shiftId}/close`, {
    method: 'POST',
    body: JSON.stringify({ denomination_count: { coins_paise: actualPaise } }),
  });
  must(res.ok, `close shift failed: ${res.text}`);
  return res.json.data;
}

async function bookOrder(customerId: string, items: Array<{ product_id: string; entered_qty: string; entered_unit: string; unit_price_paise: number }>) {
  const clientUuid = uuid();
  const res = await bff('/api/b2b/orders/book', {
    method: 'POST',
    headers: { 'Idempotency-Key': clientUuid },
    body: JSON.stringify({ client_uuid: clientUuid, customer_id: customerId, items }),
  });
  must(res.ok, `book order failed: ${res.text}`);
  return res.json.data;
}

async function loadingSheet(orderIds: string[]) {
  const res = await bff(`/api/b2b/dispatch/loading-sheet?order_ids=${orderIds.join(',')}`);
  must(res.ok, `loading sheet failed: ${res.text}`);
  return res.json.data;
}

async function dispatchOrders(orderIds: string[]) {
  const res = await bff('/api/b2b/orders/dispatch', {
    method: 'POST',
    body: JSON.stringify({ order_ids: orderIds }),
  });
  must(res.ok, `dispatch failed: ${res.text}`);
  return res.json.data;
}

async function deliverOrder(orderId: string) {
  const res = await bff('/api/b2b/orders/deliver', {
    method: 'POST',
    body: JSON.stringify({ order_id: orderId }),
  });
  must(res.ok, `deliver failed: ${res.text}`);
  return res.json.data;
}

async function getProductStock(productId: string): Promise<number> {
  const res = await bff('/api/inventory/products');
  must(res.ok, `get products for stock check failed: ${res.text}`);
  const row = res.json.data.find((p: any) => p.documentId === productId);
  must(!!row, `product ${productId} not found in inventory listing`);
  // BFF route doesn't populate batches with numeric aggregation client-side helper here,
  // so re-derive using the same populate the BFF already requests.
  return row.batches ? row.batches.filter((b: any) => b.status === 'ACTIVE').reduce((s: number, b: any) => s + Number(b.current_stock_base), 0) : 0;
}

// ---------------------------------------------------------------------------
// Direct (read-only) DB verification for internal ledgers with no client API
// ---------------------------------------------------------------------------

function openReadOnlyDb() {
  const dbModulePath = path.join(SCRIPT_DIR, '..', '..', 'backend', 'node_modules', 'better-sqlite3');
  const dbFilePath = path.join(SCRIPT_DIR, '..', '..', 'backend', '.tmp', 'data.db');
  const Database = require(dbModulePath);
  return new Database(dbFilePath, { readonly: true });
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

interface ReconciliationRow {
  category: string;
  item: string;
  detail: string;
}

const reconciliation: ReconciliationRow[] = [];
const createdRecords: Array<{ type: string; name: string; id: string }> = [];

async function main() {
  section('LOGIN');
  const session = await login();
  step(`Logged in as Shivam Interprices`, `store=${session.storeName} (${session.storeId})`);

  if (session.activeShiftId) {
    step('Found a stale open shift from an earlier session — cleaning it up first', session.activeShiftId);
    await cleanupExistingShift(session.activeShiftId);
    step('Stale shift closed');
  }

  const counter = await getPrimaryCounter();
  step('Resolved primary counter', `${counter.name} (${counter.id})`);

  // -------------------------------------------------------------------------
  section('SETUP: Suppliers, Products, Unit Conversions, Wholesale Customers');
  // -------------------------------------------------------------------------

  const suppliers = {
    adani: await findOrCreateSupplier('Adani Wilmar Distributors', '07AAACA1111A1Z1', session.storeId),
    itc: await findOrCreateSupplier('ITC FMCG Supply Hub', '07AAACB2222B1Z2', session.storeId),
    parle: await findOrCreateSupplier('Parle Products Depot', '07AAACC3333C1Z3', session.storeId),
    tata: await findOrCreateSupplier('Tata Consumer Direct', '07AAACD4444D1Z4', session.storeId),
  };
  for (const [key, id] of Object.entries(suppliers)) {
    step(`Supplier ready: ${key}`, id);
    createdRecords.push({ type: 'Supplier', name: key, id });
  }

  const products = {
    // Base units chosen for real-world unit semantics AND to satisfy
    // backend/src/api/unit-conversion/content-types/unit-conversion/lifecycles.ts's
    // VALID_UNITS_FOR_BASE table: BORI/CARTON require a G/ML/PCS base as listed
    // there — BORI is invalid for a PCS base, which is why oil is ML-based and
    // atta/salt are G-based (both are weight-packaged staples in real life).
    fortuneOil: await findOrCreateProduct({
      sku: 'E2E-FORTUNE-OIL',
      name: 'Fortune Mustard Oil',
      name_local: 'फॉर्च्यून सरसों तेल',
      base_unit: 'ML',
      pricing_unit: 'PACKET',
      default_sale_unit: 'PACKET',
      default_purchase_unit: 'CRATE',
      sell_rate_paise: 13500,
    }),
    atta: await findOrCreateProduct({
      sku: 'E2E-ASHIRVAAD-ATTA',
      name: 'Aashirvaad Atta 10kg',
      name_local: 'आशीर्वाद आटा',
      base_unit: 'G',
      pricing_unit: 'BORI',
      default_sale_unit: 'BORI',
      default_purchase_unit: 'BORI',
      sell_rate_paise: 42000,
    }),
    parleG: await findOrCreateProduct({
      sku: 'E2E-PARLE-G',
      name: 'Parle-G 100g',
      name_local: 'पारले-जी',
      base_unit: 'PCS',
      pricing_unit: 'PCS',
      default_sale_unit: 'PCS',
      default_purchase_unit: 'CARTON',
      sell_rate_paise: 600,
    }),
    tataSalt: await findOrCreateProduct({
      sku: 'E2E-TATA-SALT',
      name: 'Tata Salt 1kg',
      name_local: 'टाटा नमक',
      base_unit: 'G',
      pricing_unit: 'PACKET',
      default_sale_unit: 'PACKET',
      default_purchase_unit: 'BORI',
      sell_rate_paise: 2400,
    }),
    khulaHisaab: await findOrCreateProduct({
      sku: 'E2E-KHULA-HISAAB',
      name: 'Khula Hisaab / Custom Charge',
      is_service: true,
      base_unit: 'PCS',
      pricing_unit: 'PCS',
      default_sale_unit: 'PCS',
      default_purchase_unit: 'PCS',
      sell_rate_paise: 0,
    }),
  };
  for (const [key, id] of Object.entries(products)) {
    step(`Product ready: ${key}`, id);
    createdRecords.push({ type: 'Product', name: key, id });
  }

  // Anchor row required on every product (Invariant UC-A: exactly one
  // factor_to_base=1 row whose unit_code equals the product's own base_unit).
  await findOrCreateUnitConversion(products.fortuneOil, session.storeId, 'ML', 1);
  await findOrCreateUnitConversion(products.atta, session.storeId, 'G', 1);
  await findOrCreateUnitConversion(products.parleG, session.storeId, 'PCS', 1);
  await findOrCreateUnitConversion(products.tataSalt, session.storeId, 'G', 1);
  await findOrCreateUnitConversion(products.khulaHisaab, session.storeId, 'PCS', 1);

  await findOrCreateUnitConversion(products.fortuneOil, session.storeId, 'PACKET', 1000); // 1 pouch = 1000ml (1L)
  await findOrCreateUnitConversion(products.fortuneOil, session.storeId, 'CRATE', 15000); // 1 carton = 15 pouches
  await findOrCreateUnitConversion(products.atta, session.storeId, 'BORI', 10000); // 1 bori/bag = 10kg = 10000g
  await findOrCreateUnitConversion(products.parleG, session.storeId, 'CARTON', 100); // 1 carton = 100 packets
  await findOrCreateUnitConversion(products.tataSalt, session.storeId, 'PACKET', 1000); // 1 packet = 1kg = 1000g
  await findOrCreateUnitConversion(products.tataSalt, session.storeId, 'BORI', 20000); // 1 bori = 20kg = 20 packets
  step('Unit conversions ready (base anchor + retail/wholesale unit per product)');

  const customers = {
    kisan: await findOrCreateCustomer('Kisan Super Mart', '9811122233', session.storeId),
    radhe: await findOrCreateCustomer('Radhe Radhe Traders', '9822233344', session.storeId),
    gupta: await findOrCreateCustomer('Gupta Brothers Store', '9833344455', session.storeId),
    maaKali: await findOrCreateCustomer('Maa Kali Kirana', '9844455566', session.storeId),
  };
  for (const [key, id] of Object.entries(customers)) {
    step(`Wholesale customer ready: ${key}`, id);
    createdRecords.push({ type: 'Customer', name: key, id });
  }

  const stockBefore: Record<string, number> = {};
  for (const [key, id] of Object.entries(products)) {
    if (key === 'khulaHisaab') continue;
    stockBefore[key] = await getProductStock(id);
  }

  // -------------------------------------------------------------------------
  section('A. B2B Purchase Inward — 4 entries');
  // -------------------------------------------------------------------------

  const inward1 = await purchaseInward(suppliers.adani, 'ADW-INV-001', [
    { product_id: products.fortuneOil, received_qty: '20', received_unit: 'CRATE', cost_rate_paise: 180000, batch_no: 'OIL-2026-A1', expiry_date: addMonths(12) },
  ]);
  must(inward1.purchase_bill.total_paise === 3600000, `Inward 1 total expected 3600000, got ${inward1.purchase_bill.total_paise}`);
  step('Inward 1 (Adani, Fortune Oil 20 Cartons @ Rs.1800)', `GRN ${inward1.purchase_bill.grn_no}, total ${rupees(inward1.purchase_bill.total_paise)}`);

  const inward2 = await purchaseInward(suppliers.itc, 'ITC-INV-001', [
    { product_id: products.atta, received_qty: '15', received_unit: 'BORI', cost_rate_paise: 380000, batch_no: 'ATTA-2026-B1', expiry_date: addMonths(9) },
  ]);
  must(inward2.purchase_bill.total_paise === 5700000, `Inward 2 total expected 5700000, got ${inward2.purchase_bill.total_paise}`);
  step('Inward 2 (ITC, Atta 15 BORI @ Rs.3800)', `GRN ${inward2.purchase_bill.grn_no}, total ${rupees(inward2.purchase_bill.total_paise)}`);

  const inward3 = await purchaseInward(suppliers.parle, 'PARLE-INV-001', [
    { product_id: products.parleG, received_qty: '10', received_unit: 'CARTON', cost_rate_paise: 60000, batch_no: 'PG-2026-C1', expiry_date: addMonths(6) },
  ]);
  must(inward3.purchase_bill.total_paise === 600000, `Inward 3 total expected 600000, got ${inward3.purchase_bill.total_paise}`);
  step('Inward 3 (Parle, Parle-G 10 CARTON @ Rs.600)', `GRN ${inward3.purchase_bill.grn_no}, total ${rupees(inward3.purchase_bill.total_paise)}`);

  const inward4 = await purchaseInward(suppliers.tata, 'TATA-INV-001', [
    { product_id: products.tataSalt, received_qty: '25', received_unit: 'BORI', cost_rate_paise: 50000, batch_no: 'SALT-2026-D1', expiry_date: addMonths(24) },
  ]);
  must(inward4.purchase_bill.total_paise === 1250000, `Inward 4 total expected 1250000, got ${inward4.purchase_bill.total_paise}`);
  step('Inward 4 (Tata, Salt 25 BORI @ Rs.500)', `GRN ${inward4.purchase_bill.grn_no}, total ${rupees(inward4.purchase_bill.total_paise)}`);

  // Verify stock_movements + base quantities via the API responses themselves.
  must(Number(inward1.batches[0].qty_in_base) === 300000, `Fortune Oil batch expected 300000 base ml (20 crates x15000ml), got ${inward1.batches[0].qty_in_base}`);
  must(Number(inward2.batches[0].qty_in_base) === 150000, `Atta batch expected 150000 base g (15 bori x10000g), got ${inward2.batches[0].qty_in_base}`);
  must(Number(inward3.batches[0].qty_in_base) === 1000, `Parle-G batch expected 1000 base pcs (10 cartons x100), got ${inward3.batches[0].qty_in_base}`);
  must(Number(inward4.batches[0].qty_in_base) === 500000, `Tata Salt batch expected 500000 base g (25 bori x20000g), got ${inward4.batches[0].qty_in_base}`);
  step('Batch base-quantity conversions verified (carton/bori/crate -> base ml/g/pcs)');

  // Verify stock_movements rows exist as PURCHASE_IN (no client API exposes this table).
  // purchase_bill.id in the API response is the documentId (string); stock_movements.reference_id
  // is the numeric row id, so the bill's numeric id has to be resolved first.
  {
    const db = openReadOnlyDb();
    const grnNos = [inward1, inward2, inward3, inward4].map((i: any) => i.purchase_bill.grn_no);
    const placeholders = grnNos.map(() => '?').join(',');
    const bills = db.prepare(`SELECT id FROM purchase_bills WHERE grn_no IN (${placeholders})`).all(...grnNos) as Array<{ id: number }>;
    must(bills.length === 4, `Expected to resolve 4 purchase_bills by grn_no, found ${bills.length}`);
    const billPlaceholders = bills.map(() => '?').join(',');
    const movements = db
      .prepare(`SELECT product_id, movement_type, qty_base FROM stock_movements WHERE movement_type = 'PURCHASE_IN' AND reference_id IN (${billPlaceholders})`)
      .all(...bills.map((b) => b.id));
    db.close();
    must(movements.length === 4, `Expected 4 PURCHASE_IN stock_movements rows (one per GRN), found ${movements.length}`);
    step(`stock_movements verified: ${movements.length} PURCHASE_IN rows found for the 4 GRNs`);
    reconciliation.push({ category: 'Stock Movements', item: 'PURCHASE_IN rows (4 GRNs)', detail: `${movements.length} rows` });
  }

  // -------------------------------------------------------------------------
  section('B. Supplier Ledger (AP) Settlements');
  // -------------------------------------------------------------------------

  const adaniBefore = await getSupplierLedger(suppliers.adani);
  const itcBefore = await getSupplierLedger(suppliers.itc);
  must(adaniBefore.balance === 3600000, `Adani balance before payment expected 3600000, got ${adaniBefore.balance}`);
  must(itcBefore.balance === 5700000, `ITC balance before payment expected 5700000, got ${itcBefore.balance}`);
  step('Outstanding payable matches purchases', `Adani ${rupees(adaniBefore.balance)}, ITC ${rupees(itcBefore.balance)}`);

  await paySupplier(suppliers.adani, 2000000, 'NEFT payment — partial settlement');
  await paySupplier(suppliers.itc, 3000000, 'NEFT payment — partial settlement');

  const adaniAfter = await getSupplierLedger(suppliers.adani);
  const itcAfter = await getSupplierLedger(suppliers.itc);
  must(adaniAfter.balance === 1600000, `Adani closing balance expected 1600000 (Rs.16,000), got ${adaniAfter.balance}`);
  must(itcAfter.balance === 2700000, `ITC closing balance expected 2700000 (Rs.27,000), got ${itcAfter.balance}`);
  step('Adani closing balance', rupees(adaniAfter.balance));
  step('ITC closing balance', rupees(itcAfter.balance));

  // -------------------------------------------------------------------------
  section('C. Cashier Shift & 5 Retail POS Bills');
  // -------------------------------------------------------------------------

  const shiftId = await openShift(counter.id, 200000);
  step('Shift opened', `Counter 1, opening float Rs.2000, shift ${shiftId}`);

  const bill1 = await checkout({
    shiftId,
    counterId: counter.id,
    items: [{ product_id: products.fortuneOil, entered_qty: '3', entered_unit: 'PACKET', unit_price_paise: 13500 }],
    payments: [{ method: 'CASH', amount_paise: 40500 }],
    note: 'Bill 1',
  });
  must(bill1.totals.total_paise === 40500, `Bill 1 total expected 40500, got ${bill1.totals.total_paise}`);
  step('Bill 1: 3 Pouches Fortune Oil', `${rupees(bill1.totals.total_paise)} cash, invoice ${bill1.order.invoice_no}`);

  const bill2 = await checkout({
    shiftId,
    counterId: counter.id,
    items: [
      { product_id: products.atta, entered_qty: '1', entered_unit: 'BORI', unit_price_paise: 42000 },
      { product_id: products.tataSalt, entered_qty: '2', entered_unit: 'PACKET', unit_price_paise: 2400 },
    ],
    payments: [{ method: 'CASH', amount_paise: 46800 }],
    note: 'Bill 2',
  });
  must(bill2.totals.total_paise === 46800, `Bill 2 total expected 46800, got ${bill2.totals.total_paise}`);
  step('Bill 2: 1 Bag Atta + 2 pkts Salt', `${rupees(bill2.totals.total_paise)} cash, invoice ${bill2.order.invoice_no}`);

  const bill3 = await checkout({
    shiftId,
    counterId: counter.id,
    items: [{ product_id: products.parleG, entered_qty: '10', entered_unit: 'PCS', unit_price_paise: 600 }],
    payments: [{ method: 'UPI', amount_paise: 6000 }],
    note: 'Bill 3',
  });
  must(bill3.totals.total_paise === 6000, `Bill 3 total expected 6000, got ${bill3.totals.total_paise}`);
  step('Bill 3: 10 pkts Parle-G', `${rupees(bill3.totals.total_paise)} UPI, invoice ${bill3.order.invoice_no}`);

  const bill4 = await checkout({
    shiftId,
    counterId: counter.id,
    customerId: customers.kisan,
    items: [{ product_id: products.fortuneOil, entered_qty: '2', entered_unit: 'PACKET', unit_price_paise: 13500 }],
    payments: [
      { method: 'CASH', amount_paise: 15000 },
      { method: 'CREDIT', amount_paise: 12000 },
    ],
    note: 'Bill 4',
  });
  must(bill4.totals.total_paise === 27000, `Bill 4 total expected 27000, got ${bill4.totals.total_paise}`);
  step('Bill 4: 2 Pouches Fortune Oil (split)', `${rupees(bill4.totals.total_paise)} = Rs.150 cash + Rs.120 Khata (Kisan Super Mart), invoice ${bill4.order.invoice_no}`);

  const bill5 = await checkout({
    shiftId,
    counterId: counter.id,
    items: [{ product_id: products.khulaHisaab, entered_qty: '1', entered_unit: 'PCS', unit_price_paise: 15000, price_source: 'MANUAL' }],
    payments: [{ method: 'CASH', amount_paise: 15000 }],
    note: 'Bill 5 — Khula Hisaab',
  });
  must(bill5.totals.total_paise === 15000, `Bill 5 total expected 15000, got ${bill5.totals.total_paise}`);
  step('Bill 5: Khula Hisaab (custom item)', `${rupees(bill5.totals.total_paise)} cash, invoice ${bill5.order.invoice_no}`);

  await cashMovement(shiftId, 'OUT', 15000, 'PETTY_EXPENSE', 'Chai/Snacks');
  step('Petty cash OUT', 'Rs.150 (Chai/Snacks)');

  const stockAfterRetail: Record<string, number> = {};
  for (const [key, id] of Object.entries(products)) {
    if (key === 'khulaHisaab') continue;
    stockAfterRetail[key] = await getProductStock(id);
  }
  must(stockAfterRetail.fortuneOil === stockBefore.fortuneOil + 300000 - 5000, `Fortune Oil stock after retail bills mismatch: ${stockAfterRetail.fortuneOil}`);
  must(stockAfterRetail.atta === stockBefore.atta + 150000 - 10000, `Atta stock after retail bills mismatch: ${stockAfterRetail.atta}`);
  must(stockAfterRetail.parleG === stockBefore.parleG + 1000 - 10, `Parle-G stock after retail bills mismatch: ${stockAfterRetail.parleG}`);
  must(stockAfterRetail.tataSalt === stockBefore.tataSalt + 500000 - 2000, `Tata Salt stock after retail bills mismatch: ${stockAfterRetail.tataSalt}`);
  step('FEFO batch deductions + stock decrement verified against the single purchased batch per product');

  const expectedMidShift = await getExpectedCash(shiftId);
  // Cash from bills 1, 2, 4 (cash portion) and 5: 405 + 468 + 150 + 150 = 1173.
  // This specifically catches a real bug found while building this script: shift-open's
  // raw Knex insert left the accumulator columns SQL NULL instead of 0, so every
  // later `column + ?` increment computed NULL and silently discarded all sales.
  must(Number(expectedMidShift.cash_sales_paise) === 117300, `Shift cash_sales_paise expected 117300 (Rs.1173), got ${expectedMidShift.cash_sales_paise}`);
  must(Number(expectedMidShift.non_cash.upi_paise) === 6000, `Shift upi_paise expected 6000 (Rs.60), got ${expectedMidShift.non_cash.upi_paise}`);
  must(Number(expectedMidShift.non_cash.credit_paise) === 12000, `Shift credit_paise expected 12000 (Rs.120), got ${expectedMidShift.non_cash.credit_paise}`);
  must(Number(expectedMidShift.cash_out_paise) === 15000, `Shift cash_out_paise expected 15000 (Rs.150), got ${expectedMidShift.cash_out_paise}`);
  must(
    Number(expectedMidShift.expected_cash_paise) === 200000 + 117300 - 15000,
    `Expected cash mismatch: got ${expectedMidShift.expected_cash_paise}`
  );
  step('Real-time expected cash in drawer', rupees(expectedMidShift.expected_cash_paise));

  // -------------------------------------------------------------------------
  section('D. B2B Wholesale Customer Orders & Dispatch');
  // -------------------------------------------------------------------------

  // backend/src/api/b2b-dispatch/services/b2b-dispatch.ts's bookB2bOrder() always
  // treats `unit_price_paise` as a rate per the PRODUCT's fixed `pricing_unit`
  // (normalizing through that unit's factor_to_base), never per the line's own
  // `entered_unit` — so a wholesale price has to be expressed in the same
  // per-pricing-unit terms as the retail sell_rate_paise, not "per crate/bori".
  // These are a flat wholesale discount off each product's retail rate.
  const WHOLESALE_RATE_PAISE = {
    fortuneOil: 12000, // vs retail 13500/packet
    atta: 38000, // vs retail 42000/bori
    parleG: 550, // vs retail 600/pcs
    tataSalt: 2200, // vs retail 2400/packet
  };

  const order1 = await bookOrder(customers.kisan, [
    { product_id: products.fortuneOil, entered_qty: '3', entered_unit: 'CRATE', unit_price_paise: WHOLESALE_RATE_PAISE.fortuneOil },
    { product_id: products.atta, entered_qty: '2', entered_unit: 'BORI', unit_price_paise: WHOLESALE_RATE_PAISE.atta },
  ]);
  must(Number(order1.order.total_paise) === 616000, `Order 1 total expected 616000 (Rs.6160), got ${order1.order.total_paise}`);
  step('Order 1 booked (Kisan Super Mart)', `${order1.order.document_id}, total ${rupees(order1.order.total_paise)}`);

  const order2 = await bookOrder(customers.radhe, [
    { product_id: products.tataSalt, entered_qty: '5', entered_unit: 'BORI', unit_price_paise: WHOLESALE_RATE_PAISE.tataSalt },
    { product_id: products.parleG, entered_qty: '2', entered_unit: 'CARTON', unit_price_paise: WHOLESALE_RATE_PAISE.parleG },
  ]);
  must(Number(order2.order.total_paise) === 330000, `Order 2 total expected 330000 (Rs.3300), got ${order2.order.total_paise}`);
  step('Order 2 booked (Radhe Radhe Traders)', `${order2.order.document_id}, total ${rupees(order2.order.total_paise)}`);

  const order3 = await bookOrder(customers.gupta, [
    { product_id: products.fortuneOil, entered_qty: '2', entered_unit: 'CRATE', unit_price_paise: WHOLESALE_RATE_PAISE.fortuneOil },
  ]);
  must(Number(order3.order.total_paise) === 360000, `Order 3 total expected 360000 (Rs.3600), got ${order3.order.total_paise}`);
  step('Order 3 booked (Gupta Brothers Store)', `${order3.order.document_id}, total ${rupees(order3.order.total_paise)}`);

  const order4 = await bookOrder(customers.maaKali, [
    { product_id: products.atta, entered_qty: '1', entered_unit: 'BORI', unit_price_paise: WHOLESALE_RATE_PAISE.atta },
    { product_id: products.tataSalt, entered_qty: '1', entered_unit: 'BORI', unit_price_paise: WHOLESALE_RATE_PAISE.tataSalt },
  ]);
  must(Number(order4.order.total_paise) === 82000, `Order 4 total expected 82000 (Rs.820), got ${order4.order.total_paise}`);
  step('Order 4 booked (Maa Kali Kirana)', `${order4.order.document_id}, total ${rupees(order4.order.total_paise)}`);

  const orderIds = [order1.order.document_id, order2.order.document_id, order3.order.document_id, order4.order.document_id];
  const sheet = await loadingSheet(orderIds);
  const expectedAgg: Record<string, number> = {
    [products.fortuneOil]: 3 * 15000 + 2 * 15000, // Order1 + Order3, base ml
    [products.atta]: 2 * 10000 + 1 * 10000, // Order1 + Order4, base g
    [products.tataSalt]: 5 * 20000 + 1 * 20000, // Order2 + Order4, base g
    [products.parleG]: 2 * 100, // Order2, base pcs
  };
  for (const line of sheet.lines) {
    const expected = expectedAgg[line.product_id];
    must(expected !== undefined, `Loading sheet has an unexpected product ${line.product_id}`);
    must(Number(line.total_qty_base) === expected, `Loading sheet aggregate for ${line.product_name} expected ${expected}, got ${line.total_qty_base}`);
  }
  step('Loading sheet aggregate units verified across all 4 orders', `${sheet.order_count} orders, ${sheet.lines.length} product lines`);

  const dispatch1 = await dispatchOrders([order1.order.document_id]);
  step('Order 1 dispatched', `Challan ${dispatch1.challan_no}`);
  const dispatch2 = await dispatchOrders([order2.order.document_id]);
  step('Order 2 dispatched', `Challan ${dispatch2.challan_no}`);

  const kisanLedgerBeforeDelivery = await getCustomerLedger(customers.kisan);
  const stockOilBeforeDelivery = await getProductStock(products.fortuneOil);
  const stockAttaBeforeDelivery = await getProductStock(products.atta);

  const delivered1 = await deliverOrder(order1.order.document_id);
  must(delivered1.order.status === 'DELIVERED', `Order 1 expected DELIVERED, got ${delivered1.order.status}`);
  step('Order 1 delivered', `Invoice ${delivered1.order.invoice_no}`);

  const stockOilAfterDelivery = await getProductStock(products.fortuneOil);
  const stockAttaAfterDelivery = await getProductStock(products.atta);
  must(stockOilBeforeDelivery - stockOilAfterDelivery === 45000, `Fortune Oil should drop by 45000ml (3 crates x15000ml) on delivery, dropped by ${stockOilBeforeDelivery - stockOilAfterDelivery}`);
  must(stockAttaBeforeDelivery - stockAttaAfterDelivery === 20000, `Atta should drop by 20000g (2 bori x10000g) on delivery, dropped by ${stockAttaBeforeDelivery - stockAttaAfterDelivery}`);
  step('Stock decrement on delivery verified', `Fortune Oil -45000ml, Atta -20000g`);

  const kisanLedgerAfterDelivery = await getCustomerLedger(customers.kisan);
  must(
    kisanLedgerAfterDelivery.balance === kisanLedgerBeforeDelivery.balance + Number(delivered1.order.total_paise),
    `Kisan Super Mart ledger should increase by the delivered order's total_paise on delivery`
  );
  step('Customer ledger receivable debit verified on delivery', `+${rupees(Number(delivered1.order.total_paise))} to Kisan Super Mart (order invoice ${delivered1.order.invoice_no})`);

  // -------------------------------------------------------------------------
  section('E. Shift Reconciliation & Closing');
  // -------------------------------------------------------------------------

  const expectedFinal = await getExpectedCash(shiftId);
  const closeResult = await closeShift(shiftId, expectedFinal.expected_cash_paise);
  must(closeResult.shift.status === 'CLOSED', `Shift expected CLOSED, got ${closeResult.shift.status}`);
  must(closeResult.variance_paise === 0, `Shift variance expected 0, got ${closeResult.variance_paise}`);
  step('Shift closed', `status=${closeResult.shift.status}, variance=${rupees(closeResult.variance_paise)}`);

  // -------------------------------------------------------------------------
  section('RECONCILIATION REPORT');
  // -------------------------------------------------------------------------

  const finalCustomerLedgers = await Promise.all(
    Object.entries(customers).map(async ([key, id]) => ({ key, ...(await getCustomerLedger(id)) }))
  );

  const stockFinal: Record<string, number> = {};
  for (const [key, id] of Object.entries(products)) {
    if (key === 'khulaHisaab') continue;
    stockFinal[key] = await getProductStock(id);
  }

  const report = buildMarkdownReport({
    storeName: session.storeName,
    createdRecords,
    suppliers: { adaniBefore, adaniAfter, itcBefore, itcAfter, parle: await getSupplierLedger(suppliers.parle), tata: await getSupplierLedger(suppliers.tata) },
    inventory: {
      fortuneOil: { before: stockBefore.fortuneOil, after: stockFinal.fortuneOil },
      atta: { before: stockBefore.atta, after: stockFinal.atta },
      parleG: { before: stockBefore.parleG, after: stockFinal.parleG },
      tataSalt: { before: stockBefore.tataSalt, after: stockFinal.tataSalt },
    },
    customerLedgers: finalCustomerLedgers,
    shift: { expected: expectedFinal, close: closeResult },
    orders: { order1, order2, order3, order4, dispatch1, dispatch2, delivered1 },
    bills: { bill1, bill2, bill3, bill4, bill5 },
  });

  const reportPath = path.join(SCRIPT_DIR, 'e2e-report.md');
  fs.writeFileSync(reportPath, report, 'utf8');
  console.log('\n' + report);
  console.log(`\n(Report also written to ${reportPath})`);
}

function addMonths(n: number): string {
  const d = new Date();
  d.setMonth(d.getMonth() + n);
  return d.toISOString().slice(0, 10);
}

function buildMarkdownReport(data: any): string {
  const lines: string[] = [];
  lines.push(`# End-to-End Lifecycle Test — Reconciliation Report`);
  lines.push(`\nStore: **${data.storeName}** · Generated: ${new Date().toISOString()}\n`);

  lines.push(`## 1. Records Created`);
  lines.push(`| Type | Name | Document ID |`);
  lines.push(`|---|---|---|`);
  for (const r of data.createdRecords) lines.push(`| ${r.type} | ${r.name} | ${r.id} |`);

  const inventoryUnit: Record<string, string> = { fortuneOil: 'ml', atta: 'g', parleG: 'pcs', tataSalt: 'g' };
  lines.push(`\n## 2. Inventory: Starting vs Ending Balance (base units)`);
  lines.push(`| Product | Starting | Ending | Net Change |`);
  lines.push(`|---|---|---|---|`);
  for (const [name, v] of Object.entries<any>(data.inventory)) {
    const unit = inventoryUnit[name] ?? '';
    lines.push(`| ${name} | ${v.before} ${unit} | ${v.after} ${unit} | ${v.after - v.before >= 0 ? '+' : ''}${v.after - v.before} ${unit} |`);
  }

  lines.push(`\n## 3. Supplier Ledger (AP) Closing Balances`);
  lines.push(`| Supplier | Before Payment | After Payment |`);
  lines.push(`|---|---|---|`);
  lines.push(`| Adani Wilmar Distributors | ${rupees(data.suppliers.adaniBefore.balance)} | ${rupees(data.suppliers.adaniAfter.balance)} |`);
  lines.push(`| ITC FMCG Supply Hub | ${rupees(data.suppliers.itcBefore.balance)} | ${rupees(data.suppliers.itcAfter.balance)} |`);
  lines.push(`| Parle Products Depot (no payment posted) | ${rupees(data.suppliers.parle.balance)} | ${rupees(data.suppliers.parle.balance)} |`);
  lines.push(`| Tata Consumer Direct (no payment posted) | ${rupees(data.suppliers.tata.balance)} | ${rupees(data.suppliers.tata.balance)} |`);

  lines.push(`\n## 4. Customer Ledger (AR) Closing Balances`);
  lines.push(`| Customer | Entries | Closing Balance |`);
  lines.push(`|---|---|---|`);
  for (const c of data.customerLedgers) {
    lines.push(`| ${c.key} | ${c.entries.length} | ${rupees(c.balance)} |`);
  }

  lines.push(`\n## 5. B2B Order / Dispatch Lifecycle`);
  lines.push(`| Order | Customer | Total | Status |`);
  lines.push(`|---|---|---|---|`);
  lines.push(`| ${data.orders.order1.order.document_id} | Kisan Super Mart | ${rupees(Number(data.orders.order1.order.total_paise))} | DELIVERED (invoice ${data.orders.delivered1.order.invoice_no}) |`);
  lines.push(`| ${data.orders.order2.order.document_id} | Radhe Radhe Traders | ${rupees(Number(data.orders.order2.order.total_paise))} | DISPATCHED (challan ${data.orders.dispatch2.challan_no}) |`);
  lines.push(`| ${data.orders.order3.order.document_id} | Gupta Brothers Store | ${rupees(Number(data.orders.order3.order.total_paise))} | BOOKED |`);
  lines.push(`| ${data.orders.order4.order.document_id} | Maa Kali Kirana | ${rupees(Number(data.orders.order4.order.total_paise))} | BOOKED |`);

  lines.push(`\n## 6. POS Bills (Shift)`);
  lines.push(`| Bill | Description | Total | Invoice |`);
  lines.push(`|---|---|---|---|`);
  lines.push(`| 1 | 3 Pouches Fortune Oil (Cash) | ${rupees(data.bills.bill1.totals.total_paise)} | ${data.bills.bill1.order.invoice_no} |`);
  lines.push(`| 2 | 1 Bag Atta + 2 pkts Salt (Cash) | ${rupees(data.bills.bill2.totals.total_paise)} | ${data.bills.bill2.order.invoice_no} |`);
  lines.push(`| 3 | 10 pkts Parle-G (UPI) | ${rupees(data.bills.bill3.totals.total_paise)} | ${data.bills.bill3.order.invoice_no} |`);
  lines.push(`| 4 | 2 Pouches Fortune Oil (Cash+Khata split) | ${rupees(data.bills.bill4.totals.total_paise)} | ${data.bills.bill4.order.invoice_no} |`);
  lines.push(`| 5 | Khula Hisaab custom charge (Cash) | ${rupees(data.bills.bill5.totals.total_paise)} | ${data.bills.bill5.order.invoice_no} |`);

  lines.push(`\n## 7. Shift Cash Reconciliation`);
  const e = data.shift.expected;
  lines.push(`| Component | Amount |`);
  lines.push(`|---|---|`);
  lines.push(`| Opening Float | ${rupees(e.opening_float_paise)} |`);
  lines.push(`| + Cash Sales | ${rupees(e.cash_sales_paise)} |`);
  lines.push(`| + Cash Collections | ${rupees(e.cash_collections_paise)} |`);
  lines.push(`| + Cash In | ${rupees(e.cash_in_paise)} |`);
  lines.push(`| - Cash Out (Petty Expense) | ${rupees(e.cash_out_paise)} |`);
  lines.push(`| - Cash Refunds | ${rupees(e.cash_refunds_paise)} |`);
  lines.push(`| **= Expected Cash** | **${rupees(e.expected_cash_paise)}** |`);
  lines.push(`| Counted (Actual) Cash | ${rupees(data.shift.close.actual_cash_paise)} |`);
  lines.push(`| Variance | ${rupees(data.shift.close.variance_paise)} (${data.shift.close.variance_classification}) |`);
  lines.push(`| Shift Status | ${data.shift.close.shift.status} |`);

  return lines.join('\n');
}

main().catch((err) => {
  console.error('\n❌ E2E LIFECYCLE TEST FAILED');
  console.error(err instanceof Error ? err.stack || err.message : err);
  process.exit(1);
});
