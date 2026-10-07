/**
 * Comprehensive End-to-End Operational Lifecycle Test.
 *
 * Logs in as "Shivam Interprices" and exercises the real running system (BFF
 * at :3000 -> Strapi at :1337 -> the dev sqlite DB), exactly as a user would:
 * purchase inwarding -> supplier settlement -> a full POS shift (4 bills +
 * petty cash) -> B2B wholesale booking/dispatch/delivery -> customer khata
 * settlement -> shift close. Prints a reconciliation summary at the end.
 *
 * Calls the BFF where a route exists (checkout, shifts, b2b orders/dispatch/
 * deliver, purchase inward, inventory products, customer directory/ledger/
 * payment); calls Strapi directly with the service token only for the
 * handful of master-data writes with no BFF route yet (supplier create,
 * supplier ledger payment, unit-conversion create) — see
 * scripts/test-full-lifecycle.ts's header comment for the full rationale
 * (the /b2b/purchases, /b2b/suppliers and /b2b/dispatch pages are hardcoded
 * mock-data pickers today and can't carry real ids into the real endpoints).
 *
 * Run: node scripts/test-operational-lifecycle.ts (from frontend/, with both
 * dev servers already running).
 */

import * as fs from 'fs';
import * as path from 'path';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const SCRIPT_DIR = import.meta.dirname;
const FRONTEND_BASE = 'http://localhost:3000';

function loadEnv(): Record<string, string> {
  const text = fs.readFileSync(path.join(SCRIPT_DIR, '..', '.env.local'), 'utf8');
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
    headers: { 'Content-Type': 'application/json', Cookie: sessionCookie, 'X-Device-Id': 'e2e-operational-script', ...(opts.headers as any) },
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

function section(title: string) {
  console.log(`\n${'='.repeat(78)}\n${title}\n${'='.repeat(78)}`);
}

function step(label: string, detail?: string) {
  console.log(`  - ${label}${detail ? ' -> ' + detail : ''}`);
}

function addMonths(n: number): string {
  const d = new Date();
  d.setMonth(d.getMonth() + n);
  return d.toISOString().slice(0, 10);
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
// Master data (find-or-create so the script is safely re-runnable)
// ---------------------------------------------------------------------------

async function findOrCreateSupplier(name: string, gstin: string, storeId: string): Promise<string> {
  const list = await strapi(`/api/suppliers?filters[name][$eq]=${encodeURIComponent(name)}&filters[store][documentId][$eq]=${storeId}`);
  must(list.ok, `list suppliers failed: ${list.text}`);
  const existing = list.json?.data?.[0];
  if (existing) return existing.documentId;

  const created = await strapi('/api/suppliers', { method: 'POST', body: JSON.stringify({ data: { name, gstin, store: storeId } }) });
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
  // which fetches everything and filters client-side) — fetch all, match sku exactly.
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
    body: JSON.stringify({ data: { store: storeId, product: productId, unit_code: unitCode, factor_to_base: factorToBase, is_sale_unit: true, is_purchase_unit: true, sort_order: 1 } }),
  });
  must(created.ok, `create unit-conversion ${unitCode} for product ${productId} failed: ${created.text}`);
}

async function findOrCreateCustomer(name: string, phone: string, storeId: string): Promise<string> {
  const list = await bff('/api/customers');
  must(list.ok, `list customers failed: ${list.text}`);
  const existing = list.json?.data?.find((c: any) => c.name === name);
  if (existing) return existing.documentId;

  const created = await strapi('/api/customers', { method: 'POST', body: JSON.stringify({ data: { name, phone, store: storeId } }) });
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

async function recordCustomerPayment(customerId: string, amountPaise: number, method: string, note: string) {
  const res = await bff(`/api/customers/${customerId}/payment`, {
    method: 'POST',
    body: JSON.stringify({ amount_paise: amountPaise, method, note }),
  });
  must(res.ok, `record customer payment for ${customerId} failed: ${res.text}`);
  return res.json.data;
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
    body: JSON.stringify({ client_uuid: clientUuid, counter_id: counterId, opening_float_paise: openingFloatPaise, device_id: 'e2e-operational-script' }),
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
  const res = await bff('/api/b2b/orders/dispatch', { method: 'POST', body: JSON.stringify({ order_ids: orderIds }) });
  must(res.ok, `dispatch failed: ${res.text}`);
  return res.json.data;
}

async function deliverOrder(orderId: string) {
  const res = await bff('/api/b2b/orders/deliver', { method: 'POST', body: JSON.stringify({ order_id: orderId }) });
  must(res.ok, `deliver failed: ${res.text}`);
  return res.json.data;
}

async function getProductStock(productId: string): Promise<number> {
  const res = await bff('/api/inventory/products');
  must(res.ok, `get products for stock check failed: ${res.text}`);
  const row = res.json.data.find((p: any) => p.documentId === productId);
  must(!!row, `product ${productId} not found in inventory listing`);
  return row.batches ? row.batches.filter((b: any) => b.status === 'ACTIVE').reduce((s: number, b: any) => s + Number(b.current_stock_base), 0) : 0;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  section('LOGIN');
  const session = await login();
  step('Logged in as Shivam Interprices', `store=${session.storeName} (${session.storeId})`);

  if (session.activeShiftId) {
    step('Found a stale open shift — cleaning it up first', session.activeShiftId);
    await cleanupExistingShift(session.activeShiftId);
    step('Stale shift closed');
  }

  const counter = await getPrimaryCounter();
  step('Resolved primary counter', `${counter.name} (${counter.id})`);

  // -------------------------------------------------------------------------
  section('SETUP: Suppliers, Products, Unit Conversions, Wholesale Customers');
  // -------------------------------------------------------------------------

  // Products reuse the same real-world unit design proven in
  // scripts/test-full-lifecycle.ts: base units chosen to satisfy
  // backend/src/api/unit-conversion/content-types/unit-conversion/lifecycles.ts's
  // VALID_UNITS_FOR_BASE table (BORI/CARTON require a G/ML/PCS base — BORI is
  // invalid for a PCS base, so oil is ML-based, atta is G-based).
  const suppliers = {
    adani: await findOrCreateSupplier('Adani Wilmar', '07AAACA1111A1Z1', session.storeId),
    itc: await findOrCreateSupplier('ITC FMCG Hub', '07AAACB2222B1Z2', session.storeId),
    parle: await findOrCreateSupplier('Parle Products', '07AAACC3333C1Z3', session.storeId),
  };
  for (const [key, id] of Object.entries(suppliers)) step(`Supplier ready: ${key}`, id);

  const products = {
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
  for (const [key, id] of Object.entries(products)) step(`Product ready: ${key}`, id);

  await findOrCreateUnitConversion(products.fortuneOil, session.storeId, 'ML', 1);
  await findOrCreateUnitConversion(products.atta, session.storeId, 'G', 1);
  await findOrCreateUnitConversion(products.parleG, session.storeId, 'PCS', 1);
  await findOrCreateUnitConversion(products.khulaHisaab, session.storeId, 'PCS', 1);
  await findOrCreateUnitConversion(products.fortuneOil, session.storeId, 'PACKET', 1000); // 1 pouch = 1000ml (1L)
  await findOrCreateUnitConversion(products.fortuneOil, session.storeId, 'CRATE', 15000); // 1 crate = 15 pouches
  await findOrCreateUnitConversion(products.atta, session.storeId, 'BORI', 10000); // 1 bori/bag = 10kg
  await findOrCreateUnitConversion(products.parleG, session.storeId, 'CARTON', 100); // 1 carton = 100 packets
  step('Unit conversions ready (base anchor + retail/wholesale unit per product)');

  const customers = {
    kisan: await findOrCreateCustomer('Kisan Super Mart', '9811122233', session.storeId),
    radhe: await findOrCreateCustomer('Radhe Traders', '9855566677', session.storeId),
  };
  for (const [key, id] of Object.entries(customers)) step(`Wholesale customer ready: ${key}`, id);

  const stockInitial: Record<string, number> = {};
  for (const key of ['fortuneOil', 'atta', 'parleG'] as const) stockInitial[key] = await getProductStock(products[key]);

  // -------------------------------------------------------------------------
  section('Step 1. Purchase Inwarding — 3 entries');
  // -------------------------------------------------------------------------

  const inward1 = await purchaseInward(suppliers.adani, 'ADW-OP-001', [
    { product_id: products.fortuneOil, received_qty: '20', received_unit: 'CRATE', cost_rate_paise: 180000, batch_no: 'OIL-OP-A1', expiry_date: addMonths(12) },
  ]);
  must(inward1.purchase_bill.total_paise === 3600000, `Inward 1 total expected 3600000, got ${inward1.purchase_bill.total_paise}`);
  step('Inward 1 (Adani Wilmar, Fortune Oil 20 Cartons @ Rs.1800)', `GRN ${inward1.purchase_bill.grn_no}, total ${rupees(inward1.purchase_bill.total_paise)}`);

  const inward2 = await purchaseInward(suppliers.itc, 'ITC-OP-001', [
    { product_id: products.atta, received_qty: '15', received_unit: 'BORI', cost_rate_paise: 380000, batch_no: 'ATTA-OP-B1', expiry_date: addMonths(9) },
  ]);
  must(inward2.purchase_bill.total_paise === 5700000, `Inward 2 total expected 5700000, got ${inward2.purchase_bill.total_paise}`);
  step('Inward 2 (ITC FMCG Hub, Atta 15 Bori @ Rs.3800)', `GRN ${inward2.purchase_bill.grn_no}, total ${rupees(inward2.purchase_bill.total_paise)}`);

  const inward3 = await purchaseInward(suppliers.parle, 'PARLE-OP-001', [
    { product_id: products.parleG, received_qty: '10', received_unit: 'CARTON', cost_rate_paise: 60000, batch_no: 'PG-OP-C1', expiry_date: addMonths(6) },
  ]);
  must(inward3.purchase_bill.total_paise === 600000, `Inward 3 total expected 600000, got ${inward3.purchase_bill.total_paise}`);
  step('Inward 3 (Parle Products, Parle-G 10 Cartons @ Rs.600)', `GRN ${inward3.purchase_bill.grn_no}, total ${rupees(inward3.purchase_bill.total_paise)}`);

  const inwarded: Record<string, number> = {
    fortuneOil: Number(inward1.batches[0].qty_in_base),
    atta: Number(inward2.batches[0].qty_in_base),
    parleG: Number(inward3.batches[0].qty_in_base),
  };
  must(inwarded.fortuneOil === 300000, `Fortune Oil batch expected 300000 base ml, got ${inwarded.fortuneOil}`);
  must(inwarded.atta === 150000, `Atta batch expected 150000 base g, got ${inwarded.atta}`);
  must(inwarded.parleG === 1000, `Parle-G batch expected 1000 base pcs, got ${inwarded.parleG}`);
  step('Batch base-quantity conversions verified (carton/bori/crate -> base ml/g/pcs)');

  {
    const db = openReadOnlyDb();
    const grnNos = [inward1, inward2, inward3].map((i: any) => i.purchase_bill.grn_no);
    const placeholders = grnNos.map(() => '?').join(',');
    const bills = db.prepare(`SELECT id FROM purchase_bills WHERE grn_no IN (${placeholders})`).all(...grnNos) as Array<{ id: number }>;
    must(bills.length === 3, `Expected to resolve 3 purchase_bills by grn_no, found ${bills.length}`);
    const billPlaceholders = bills.map(() => '?').join(',');
    const movements = db
      .prepare(`SELECT product_id FROM stock_movements WHERE movement_type = 'PURCHASE_IN' AND reference_id IN (${billPlaceholders})`)
      .all(...bills.map((b) => b.id));
    db.close();
    must(movements.length === 3, `Expected 3 PURCHASE_IN stock_movements rows, found ${movements.length}`);
    step(`stock_movements verified: ${movements.length} PURCHASE_IN rows found for the 3 GRNs`);
  }

  const adaniLedgerBefore = await getSupplierLedger(suppliers.adani);
  must(adaniLedgerBefore.balance === 3600000, `Adani balance before payment expected 3600000, got ${adaniLedgerBefore.balance}`);
  step('Supplier credit posting verified in supplier_ledger_entries', `Adani payable ${rupees(adaniLedgerBefore.balance)}`);

  // -------------------------------------------------------------------------
  section('Step 2. Supplier Payment Settlement');
  // -------------------------------------------------------------------------

  await paySupplier(suppliers.adani, 1500000, 'Bank transfer — partial settlement');
  const adaniLedgerAfter = await getSupplierLedger(suppliers.adani);
  must(adaniLedgerAfter.balance === 2100000, `Adani closing balance expected 2100000 (Rs.21,000), got ${adaniLedgerAfter.balance}`);
  step('Paid Adani Wilmar Rs.15,000 via BANK', `running balance now ${rupees(adaniLedgerAfter.balance)}`);

  // -------------------------------------------------------------------------
  section('Step 3. Retail POS Counter Billing — 4 bills + petty cash');
  // -------------------------------------------------------------------------

  const shiftId = await openShift(counter.id, 200000);
  step('Shift opened', `Counter 1, opening float Rs.2000, shift ${shiftId}`);

  const bill1 = await checkout({
    shiftId,
    counterId: counter.id,
    items: [{ product_id: products.fortuneOil, entered_qty: '3', entered_unit: 'PACKET', unit_price_paise: 13500 }],
    payments: [{ method: 'CASH', amount_paise: 40500 }],
    note: 'Bill 1 — Cash sale',
  });
  must(bill1.totals.total_paise === 40500, `Bill 1 total expected 40500, got ${bill1.totals.total_paise}`);
  step('Bill 1 (Cash): 3 Pouches Fortune Oil', `${rupees(bill1.totals.total_paise)}, invoice ${bill1.order.invoice_no}`);

  const bill2 = await checkout({
    shiftId,
    counterId: counter.id,
    items: [{ product_id: products.parleG, entered_qty: '10', entered_unit: 'PCS', unit_price_paise: 600 }],
    payments: [{ method: 'UPI', amount_paise: 6000 }],
    note: 'Bill 2 — UPI sale',
  });
  must(bill2.totals.total_paise === 6000, `Bill 2 total expected 6000, got ${bill2.totals.total_paise}`);
  step('Bill 2 (UPI): 10 pkts Parle-G', `${rupees(bill2.totals.total_paise)}, invoice ${bill2.order.invoice_no}`);

  const bill3 = await checkout({
    shiftId,
    counterId: counter.id,
    customerId: customers.kisan,
    items: [{ product_id: products.atta, entered_qty: '1', entered_unit: 'BORI', unit_price_paise: 42000 }],
    payments: [
      { method: 'CASH', amount_paise: 30000 },
      { method: 'CREDIT', amount_paise: 12000 },
    ],
    note: 'Bill 3 — Split Cash + Khata',
  });
  must(bill3.totals.total_paise === 42000, `Bill 3 total expected 42000, got ${bill3.totals.total_paise}`);
  step('Bill 3 (Split): 1 Bag Atta', `${rupees(bill3.totals.total_paise)} = Rs.300 cash + Rs.120 Khata (Kisan Super Mart), invoice ${bill3.order.invoice_no}`);

  const bill4 = await checkout({
    shiftId,
    counterId: counter.id,
    items: [{ product_id: products.khulaHisaab, entered_qty: '1', entered_unit: 'PCS', unit_price_paise: 15000, price_source: 'MANUAL' }],
    payments: [{ method: 'CASH', amount_paise: 15000 }],
    note: 'Bill 4 — Khula Hisaab',
  });
  must(bill4.totals.total_paise === 15000, `Bill 4 total expected 15000, got ${bill4.totals.total_paise}`);
  step('Bill 4 (Khula Hisaab custom entry)', `${rupees(bill4.totals.total_paise)} cash, invoice ${bill4.order.invoice_no}`);

  await cashMovement(shiftId, 'OUT', 15000, 'PETTY_EXPENSE', 'Refreshments');
  step('Petty cash OUT', 'Rs.150 (refreshments)');

  const stockAfterRetail: Record<string, number> = {};
  for (const key of ['fortuneOil', 'atta', 'parleG'] as const) stockAfterRetail[key] = await getProductStock(products[key]);
  const soldBase: Record<string, number> = {
    fortuneOil: 3 * 1000,
    atta: 1 * 10000,
    parleG: 10 * 1,
  };
  must(stockAfterRetail.fortuneOil === stockInitial.fortuneOil + inwarded.fortuneOil - soldBase.fortuneOil, `Fortune Oil stock after retail mismatch: ${stockAfterRetail.fortuneOil}`);
  must(stockAfterRetail.atta === stockInitial.atta + inwarded.atta - soldBase.atta, `Atta stock after retail mismatch: ${stockAfterRetail.atta}`);
  must(stockAfterRetail.parleG === stockInitial.parleG + inwarded.parleG - soldBase.parleG, `Parle-G stock after retail mismatch: ${stockAfterRetail.parleG}`);
  step('FEFO batch deductions + stock decrement verified against the single purchased batch per product');

  const expectedMidShift = await getExpectedCash(shiftId);
  // Cash from bills 1, 3 (cash portion) and 4: 405 + 300 + 150 = 855.
  must(Number(expectedMidShift.cash_sales_paise) === 85500, `Shift cash_sales_paise expected 85500 (Rs.855), got ${expectedMidShift.cash_sales_paise}`);
  must(Number(expectedMidShift.non_cash.upi_paise) === 6000, `Shift upi_paise expected 6000 (Rs.60), got ${expectedMidShift.non_cash.upi_paise}`);
  must(Number(expectedMidShift.non_cash.credit_paise) === 12000, `Shift credit_paise expected 12000 (Rs.120), got ${expectedMidShift.non_cash.credit_paise}`);
  must(Number(expectedMidShift.cash_out_paise) === 15000, `Shift cash_out_paise expected 15000 (Rs.150), got ${expectedMidShift.cash_out_paise}`);
  step('Real-time expected cash in drawer', rupees(expectedMidShift.expected_cash_paise));

  // -------------------------------------------------------------------------
  section('Step 4. B2B Wholesale Dispatch');
  // -------------------------------------------------------------------------

  // backend/src/api/b2b-dispatch/services/b2b-dispatch.ts's bookB2bOrder() always
  // treats `unit_price_paise` as a rate per the PRODUCT's fixed `pricing_unit`
  // (normalizing through that unit's factor_to_base), never per the line's own
  // `entered_unit` — a flat wholesale discount off each product's retail rate.
  const WHOLESALE_RATE_PAISE = { fortuneOil: 12000, atta: 38000, parleG: 550 };

  const order1 = await bookOrder(customers.kisan, [
    { product_id: products.fortuneOil, entered_qty: '3', entered_unit: 'CRATE', unit_price_paise: WHOLESALE_RATE_PAISE.fortuneOil },
    { product_id: products.atta, entered_qty: '2', entered_unit: 'BORI', unit_price_paise: WHOLESALE_RATE_PAISE.atta },
  ]);
  must(Number(order1.order.total_paise) === 616000, `Order 1 total expected 616000 (Rs.6160), got ${order1.order.total_paise}`);
  step('Order 1 booked (Kisan Super Mart)', `${order1.order.document_id}, total ${rupees(order1.order.total_paise)}`);

  const order2 = await bookOrder(customers.radhe, [
    { product_id: products.parleG, entered_qty: '2', entered_unit: 'CARTON', unit_price_paise: WHOLESALE_RATE_PAISE.parleG },
    { product_id: products.atta, entered_qty: '1', entered_unit: 'BORI', unit_price_paise: WHOLESALE_RATE_PAISE.atta },
  ]);
  must(Number(order2.order.total_paise) === 148000, `Order 2 total expected 148000 (Rs.1480), got ${order2.order.total_paise}`);
  step('Order 2 booked (Radhe Traders)', `${order2.order.document_id}, total ${rupees(order2.order.total_paise)}`);

  const orderIds = [order1.order.document_id, order2.order.document_id];
  const sheet = await loadingSheet(orderIds);
  const expectedAgg: Record<string, number> = {
    [products.fortuneOil]: 3 * 15000,
    [products.atta]: 2 * 10000 + 1 * 10000,
    [products.parleG]: 2 * 100,
  };
  for (const line of sheet.lines) {
    const expected = expectedAgg[line.product_id];
    must(expected !== undefined, `Loading sheet has an unexpected product ${line.product_id}`);
    must(Number(line.total_qty_base) === expected, `Loading sheet aggregate for ${line.product_name} expected ${expected}, got ${line.total_qty_base}`);
  }
  step('Loading sheet aggregate units verified across both orders', `${sheet.order_count} orders, ${sheet.lines.length} product lines`);

  const dispatch1 = await dispatchOrders([order1.order.document_id]);
  step('Order 1 dispatched (Kisan Super Mart)', `Challan ${dispatch1.challan_no}`);
  const dispatch2 = await dispatchOrders([order2.order.document_id]);
  step('Order 2 dispatched (Radhe Traders)', `Challan ${dispatch2.challan_no}`);

  const kisanLedgerBeforeDelivery = await getCustomerLedger(customers.kisan);
  const stockOilBeforeDelivery = await getProductStock(products.fortuneOil);
  const stockAttaBeforeDelivery = await getProductStock(products.atta);

  const delivered1 = await deliverOrder(order1.order.document_id);
  must(delivered1.order.status === 'DELIVERED', `Order 1 expected DELIVERED, got ${delivered1.order.status}`);
  step('Order 1 delivered (Kisan Super Mart)', `Invoice ${delivered1.order.invoice_no}`);

  const stockOilAfterDelivery = await getProductStock(products.fortuneOil);
  const stockAttaAfterDelivery = await getProductStock(products.atta);
  const dispatchedBase: Record<string, number> = {
    fortuneOil: stockOilBeforeDelivery - stockOilAfterDelivery,
    atta: stockAttaBeforeDelivery - stockAttaAfterDelivery,
    parleG: 0, // Radhe's order (which includes Parle-G) is only DISPATCHED, not delivered — stock only moves at delivery.
  };
  must(dispatchedBase.fortuneOil === 45000, `Fortune Oil should drop by 45000ml (3 crates x15000ml) on delivery, dropped by ${dispatchedBase.fortuneOil}`);
  must(dispatchedBase.atta === 20000, `Atta should drop by 20000g (2 bori x10000g) on delivery, dropped by ${dispatchedBase.atta}`);
  step('Stock decrement on delivery verified', `Fortune Oil -45000ml, Atta -20000g`);

  const kisanLedgerAfterDelivery = await getCustomerLedger(customers.kisan);
  must(
    kisanLedgerAfterDelivery.balance === kisanLedgerBeforeDelivery.balance + Number(delivered1.order.total_paise),
    `Kisan Super Mart ledger should increase by the delivered order's total_paise on delivery`
  );
  step('Invoice posting into Customer Khata verified', `+${rupees(Number(delivered1.order.total_paise))} to Kisan Super Mart (invoice ${delivered1.order.invoice_no})`);

  // -------------------------------------------------------------------------
  section('Step 5. Customer Khata Settlement & Shift Close');
  // -------------------------------------------------------------------------

  const kisanBalanceBeforeSettlement = kisanLedgerAfterDelivery.balance;
  await recordCustomerPayment(customers.kisan, 300000, 'UPI', 'Partial khata settlement');
  const kisanLedgerAfterSettlement = await getCustomerLedger(customers.kisan);
  must(
    kisanLedgerAfterSettlement.balance === kisanBalanceBeforeSettlement - 300000,
    `Kisan Super Mart balance should drop by Rs.3000 after settlement, got ${kisanLedgerAfterSettlement.balance} (was ${kisanBalanceBeforeSettlement})`
  );
  step('Customer Khata settlement recorded', `Kisan Super Mart paid Rs.3000 via UPI, balance now ${rupees(kisanLedgerAfterSettlement.balance)}`);

  const expectedFinal = await getExpectedCash(shiftId);
  must(
    Number(expectedFinal.expected_cash_paise) === 200000 + 85500 - 15000,
    `Final expected cash mismatch: got ${expectedFinal.expected_cash_paise}`
  );
  const closeResult = await closeShift(shiftId, expectedFinal.expected_cash_paise);
  must(closeResult.shift.status === 'CLOSED', `Shift expected CLOSED, got ${closeResult.shift.status}`);
  must(closeResult.variance_paise === 0, `Shift variance expected 0, got ${closeResult.variance_paise}`);
  step('Shift closed', `status=${closeResult.shift.status}, variance=${rupees(closeResult.variance_paise)}`);

  // -------------------------------------------------------------------------
  section('FINAL EXECUTION SUMMARY');
  // -------------------------------------------------------------------------

  const stockFinal: Record<string, number> = {};
  for (const key of ['fortuneOil', 'atta', 'parleG'] as const) stockFinal[key] = await getProductStock(products[key]);

  const parleLedger = await getSupplierLedger(suppliers.parle);
  const itcLedger = await getSupplierLedger(suppliers.itc);
  const radheLedger = await getCustomerLedger(customers.radhe);

  const report = buildMarkdownReport({
    storeName: session.storeName,
    inventory: [
      { name: 'Fortune Mustard Oil', unit: 'ml', initial: stockInitial.fortuneOil, inwarded: inwarded.fortuneOil, sold: soldBase.fortuneOil, dispatched: dispatchedBase.fortuneOil, final: stockFinal.fortuneOil },
      { name: 'Aashirvaad Atta 10kg', unit: 'g', initial: stockInitial.atta, inwarded: inwarded.atta, sold: soldBase.atta, dispatched: dispatchedBase.atta, final: stockFinal.atta },
      { name: 'Parle-G 100g', unit: 'pcs', initial: stockInitial.parleG, inwarded: inwarded.parleG, sold: soldBase.parleG, dispatched: dispatchedBase.parleG, final: stockFinal.parleG },
    ],
    // Debit/credit are this run's own known actions, not a sum over the ledger
    // history — this tenant's supplier/customer records are reused (find-or-create)
    // across repeated runs against a persistent dev DB, so summing all entries ever
    // posted would double-count earlier runs. The closing balance is always the
    // live current balance regardless.
    ledgers: [
      { entity: 'Adani Wilmar', type: 'Supplier (AP)', debit: 1500000, credit: 3600000, closing: adaniLedgerAfter.balance },
      { entity: 'ITC FMCG Hub', type: 'Supplier (AP)', debit: 0, credit: 5700000, closing: itcLedger.balance },
      { entity: 'Parle Products', type: 'Supplier (AP)', debit: 0, credit: 600000, closing: parleLedger.balance },
      { entity: 'Kisan Super Mart', type: 'Customer (AR)', debit: 12000 + Number(delivered1.order.total_paise), credit: 300000, closing: kisanLedgerAfterSettlement.balance },
      { entity: 'Radhe Traders', type: 'Customer (AR)', debit: 0, credit: 0, closing: radheLedger.balance },
    ],
    cash: {
      float: 200000,
      cashSales: Number(expectedFinal.cash_sales_paise),
      pettyOut: Number(expectedFinal.cash_out_paise),
      expected: Number(expectedFinal.expected_cash_paise),
      counted: Number(closeResult.actual_cash_paise),
      variance: Number(closeResult.variance_paise),
    },
  });

  const reportPath = path.join(SCRIPT_DIR, 'operational-lifecycle-report.md');
  fs.writeFileSync(reportPath, report, 'utf8');
  console.log('\n' + report);
  console.log(`\n(Report also written to ${reportPath})`);
}

function openReadOnlyDb() {
  const dbModulePath = path.join(SCRIPT_DIR, '..', '..', 'backend', 'node_modules', 'better-sqlite3');
  const dbFilePath = path.join(SCRIPT_DIR, '..', '..', 'backend', '.tmp', 'data.db');
  const Database = require(dbModulePath);
  return new Database(dbFilePath, { readonly: true });
}

function buildMarkdownReport(data: any): string {
  const lines: string[] = [];
  lines.push(`# Operational Lifecycle Test — Execution Summary`);
  lines.push(`\nStore: **${data.storeName}** · Generated: ${new Date().toISOString()}\n`);

  lines.push(`## Inventory Reconciliation`);
  lines.push(`| Product | Initial | Inwarded | Sold | Dispatched | Final Stock |`);
  lines.push(`|---|---|---|---|---|---|`);
  for (const p of data.inventory) {
    lines.push(`| ${p.name} | ${p.initial} ${p.unit} | +${p.inwarded} ${p.unit} | -${p.sold} ${p.unit} | -${p.dispatched} ${p.unit} | ${p.final} ${p.unit} |`);
  }

  lines.push(`\n## Financial / Ledger Summary`);
  lines.push(`| Entity | Type | Total Debit | Total Credit | Closing Balance |`);
  lines.push(`|---|---|---|---|---|`);
  for (const l of data.ledgers) {
    lines.push(`| ${l.entity} | ${l.type} | ${rupees(l.debit)} | ${rupees(l.credit)} | ${rupees(l.closing)} |`);
  }

  lines.push(`\n## Cash Drawer Reconciliation`);
  lines.push(`| Component | Amount |`);
  lines.push(`|---|---|`);
  lines.push(`| Opening Float | ${rupees(data.cash.float)} |`);
  lines.push(`| + Cash Sales | ${rupees(data.cash.cashSales)} |`);
  lines.push(`| - Petty Cash Out | ${rupees(data.cash.pettyOut)} |`);
  lines.push(`| **= Expected Cash** | **${rupees(data.cash.expected)}** |`);
  lines.push(`| Counted Cash | ${rupees(data.cash.counted)} |`);
  lines.push(`| Variance | ${rupees(data.cash.variance)} |`);

  return lines.join('\n');
}

main().catch((err) => {
  console.error('\n❌ OPERATIONAL LIFECYCLE TEST FAILED');
  console.error(err instanceof Error ? err.stack || err.message : err);
  process.exit(1);
});
