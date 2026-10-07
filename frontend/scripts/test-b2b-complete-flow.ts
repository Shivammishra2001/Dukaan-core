/**
 * B2B Wholesale Engine — Combined Operational + UI/UX Verification.
 *
 * Exercises the milestone described in the task: tenant create/verify,
 * freight-allocated purchase inward, tiered wholesale order booking across
 * two customers, vehicle-assigned dispatch + delivery challan + DELIVERED,
 * a customer collection settlement, and a real (Playwright-driven) check
 * that the language switcher and theme picker built in Part 1 actually work
 * in the browser with no console/runtime errors.
 *
 * Run: node scripts/test-b2b-complete-flow.ts (from frontend/, with both
 * dev servers already running — `npm install -D playwright` was run once
 * to add the browser driver used only by this script's UI check).
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
let sessionToken = '';

interface FetchResult {
  ok: boolean;
  status: number;
  json: any;
  text: string;
}

async function bff(urlPath: string, opts: RequestInit = {}): Promise<FetchResult> {
  const res = await fetch(`${FRONTEND_BASE}${urlPath}`, {
    ...opts,
    headers: { 'Content-Type': 'application/json', Cookie: sessionCookie, 'X-Device-Id': 'e2e-b2b-complete-flow', ...(opts.headers as any) },
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
// Auth — "Create/verify the tenant": try login first (Harshit Enterprises may
// already exist from a prior provisioning pass), fall back to registering it
// if the phone genuinely isn't registered yet (ERR_PHONE_TAKEN on the
// register endpoint means it already exists and login should be retried).
// ---------------------------------------------------------------------------

const LOGIN_PHONE = '9876543210';
const LOGIN_PASSWORD = 'testpass123';

async function tryLogin(): Promise<boolean> {
  const res = await fetch(`${FRONTEND_BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ identifier: LOGIN_PHONE, password: LOGIN_PASSWORD }),
  });
  if (!res.ok) return false;
  const cookies = (res.headers as any).getSetCookie ? (res.headers as any).getSetCookie() : [res.headers.get('set-cookie')];
  const dukaanCookie = (cookies as string[]).find((c) => c && c.startsWith('dukaan_session='));
  if (!dukaanCookie) return false;
  sessionCookie = dukaanCookie.split(';')[0];
  sessionToken = sessionCookie.split('=')[1]!;
  return true;
}

async function registerTenant(): Promise<void> {
  const res = await fetch(`${FRONTEND_BASE}/api/auth/register-company`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      company_name: 'Harshit Enterprises',
      business_preset: 'DISTRIBUTOR',
      owner_name: 'Harshit Owner',
      phone: LOGIN_PHONE,
      password: LOGIN_PASSWORD,
      state: '07',
      city: 'New Delhi',
    }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok && body?.error?.code !== 'ERR_PHONE_TAKEN') {
    throw new Error(`register-company failed (${res.status}): ${JSON.stringify(body)}`);
  }
}

async function login(): Promise<{ storeId: string; tenantId: string; storeName: string; storeCode: string; activeShiftId: string | null }> {
  let ok = await tryLogin();
  if (!ok) {
    await registerTenant();
    ok = await tryLogin();
  }
  must(ok, 'login failed even after attempting to register the tenant');

  const me = await bff('/api/auth/me');
  must(me.ok, `GET /api/auth/me failed after login: ${me.text}`);
  return {
    storeId: me.json.data.store.id,
    tenantId: me.json.data.tenant_id,
    storeName: me.json.data.store.name,
    storeCode: me.json.data.store.code,
    activeShiftId: me.json.data.active_shift?.id ?? null,
  };
}

// ---------------------------------------------------------------------------
// Master data lookups
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

async function findOrCreateCustomer(name: string, phone: string, storeId: string): Promise<string> {
  const list = await bff('/api/customers');
  must(list.ok, `list customers failed: ${list.text}`);
  const existing = list.json?.data?.find((c: any) => c.name === name);
  if (existing) return existing.documentId;
  const created = await strapi('/api/customers', { method: 'POST', body: JSON.stringify({ data: { name, phone, store: storeId } }) });
  must(created.ok, `create customer "${name}" failed: ${created.text}`);
  return created.json.data.documentId;
}

async function resolveProductBySku(sku: string): Promise<any> {
  const list = await bff('/api/inventory/products');
  must(list.ok, `list products failed: ${list.text}`);
  const existing = list.json?.data?.find((p: any) => p.sku === sku);
  must(!!existing, `product with sku ${sku} not found — expected the Harshit Enterprises catalogue to already be seeded`);
  return existing;
}

/** PATCH /api/inventory/products/{id} — sets the two wholesale tier rates used to prove tiered pricing actually changes the booked rate. */
async function setWholesaleTiers(productId: string, tier1Paise: number, tier2Paise: number): Promise<void> {
  const res = await bff(`/api/inventory/products/${productId}`, {
    method: 'PATCH',
    body: JSON.stringify({ wholesale_tier1_rate_paise: tier1Paise, wholesale_tier2_rate_paise: tier2Paise }),
  });
  must(res.ok, `set wholesale tiers failed: ${res.text}`);
}

// ---------------------------------------------------------------------------
// Transactional operations
// ---------------------------------------------------------------------------

async function purchaseInward(supplierId: string, invoiceNo: string, items: any[], freightPaise: number) {
  const clientUuid = uuid();
  const res = await bff('/api/b2b/purchases/inward', {
    method: 'POST',
    headers: { 'Idempotency-Key': clientUuid },
    body: JSON.stringify({ client_uuid: clientUuid, supplier_id: supplierId, supplier_invoice_no: invoiceNo, items, freight_paise: freightPaise }),
  });
  must(res.ok, `purchase inward (${invoiceNo}) failed: ${res.text}`);
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
  const res = await bff(`/api/customers/${customerId}/payment`, { method: 'POST', body: JSON.stringify({ amount_paise: amountPaise, method, note }) });
  must(res.ok, `record customer payment for ${customerId} failed: ${res.text}`);
  return res.json.data;
}

async function bookOrder(customerId: string, items: Array<{ product_id: string; entered_qty: string; entered_unit: string; unit_price_paise?: number }>) {
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

async function dispatchOrders(orderIds: string[], opts: { vehicle_no: string; transporter: string; driver_name: string; freight_paise: number; freight_terms: string }) {
  const res = await bff('/api/b2b/orders/dispatch', { method: 'POST', body: JSON.stringify({ order_ids: orderIds, ...opts }) });
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
// Part 1 verification — real browser check (Playwright) that the language
// switcher and theme picker (built in this same task's Part 1) work with no
// console/runtime errors, not just that the code compiles.
// ---------------------------------------------------------------------------

async function verifyLanguageAndTheme(): Promise<{ languageOk: boolean; themeOk: boolean; consoleErrors: string[] }> {
  const { chromium } = require('playwright');
  const browser = await chromium.launch();
  const context = await browser.newContext();
  await context.addCookies([{ name: 'dukaan_session', value: sessionToken, domain: 'localhost', path: '/', httpOnly: true, sameSite: 'Lax' }]);
  const page = await context.newPage();
  const consoleErrors: string[] = [];
  page.on('console', (msg: any) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });
  page.on('pageerror', (err: Error) => consoleErrors.push(String(err)));

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`${FRONTEND_BASE}/dashboard`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(600);

  // --- Language switch: click the Hindi segment, confirm a nav label actually re-renders in Devanagari ---
  const dashboardNavLink = page.locator('a[href="/dashboard"]').first();
  const beforeSwitch = (await dashboardNavLink.innerText()).trim();
  await page.locator('button[aria-pressed]', { hasText: 'हिं' }).first().click();
  await page.waitForTimeout(300);
  const afterHindi = (await dashboardNavLink.innerText()).trim();
  const languageOk = afterHindi.includes('डैशबोर्ड') && afterHindi !== beforeSwitch;

  // switch back to English for a clean re-run
  await page.locator('button[aria-pressed]', { hasText: 'EN' }).first().click();
  await page.waitForTimeout(200);

  // --- Theme switch: open the picker, pick "Kirana Forest Green", confirm document.documentElement's data-theme attribute actually changes ---
  const initialTheme = await page.evaluate(() => document.documentElement.getAttribute('data-theme'));
  await page.locator('button[aria-label="Theme"]').first().click();
  await page.waitForTimeout(200);
  await page.locator('button', { hasText: 'Kirana Forest Green' }).first().click();
  await page.waitForTimeout(300);
  const afterGreen = await page.evaluate(() => document.documentElement.getAttribute('data-theme'));
  const themeOk = afterGreen === 'green' && afterGreen !== initialTheme;

  // reset to blue for a clean re-run
  await page.locator('button[aria-label="Theme"]').first().click();
  await page.waitForTimeout(200);
  await page.locator('button', { hasText: 'Professional Blue' }).first().click();
  await page.waitForTimeout(200);

  await browser.close();
  return { languageOk, themeOk, consoleErrors };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  section('STEP 1. Create / Verify Tenant');
  const session = await login();
  step('Harshit Enterprises session ready', `store=${session.storeName} (code ${session.storeCode}, ${session.storeId})`);

  const oil = await resolveProductBySku('FORT-OIL-1L');
  step('Resolved product for this run', `Fortune Mustard Oil (${oil.documentId}), GST ${oil.gst_rate}%`);

  await setWholesaleTiers(oil.documentId, 12000, 11000);
  step('Wholesale tiers set on Fortune Mustard Oil', 'Tier-1 Rs.120/pcs (5-20 cartons), Tier-2 Rs.110/pcs (20+ cartons)');

  const suppliers = { adani: await findOrCreateSupplier('Adani Wilmar Supply Co.', '07AAACA1111A1Z1', session.storeId) };
  const customers = {
    kisan: await findOrCreateCustomer('Kisan Super Mart', '9811002200', session.storeId),
    radhe: await findOrCreateCustomer('Radhe Traders', '9822003300', session.storeId),
  };
  step('Suppliers & customers ready', `Adani ${suppliers.adani}; Kisan ${customers.kisan}; Radhe ${customers.radhe}`);

  const stockBeforeInward = await getProductStock(oil.documentId);
  const adaniBalanceBefore = (await getSupplierLedger(suppliers.adani)).balance;

  // -------------------------------------------------------------------------
  section('STEP 2. Purchase Inward with Freight Allocation');
  // -------------------------------------------------------------------------

  const FREIGHT_PAISE = 9000; // Rs.90 vehicle/freight charge for this single-line GRN
  const inward = await purchaseInward(suppliers.adani, 'ADW-B2B-001', [
    { product_id: oil.documentId, received_qty: '30', received_unit: 'CARTON', cost_rate_paise: 180000, batch_no: 'OIL-B2B-B1', expiry_date: addMonths(12) },
  ], FREIGHT_PAISE);

  const oilGstRate = Number(oil.gst_rate);
  const inwardSubtotal = 30 * 180000; // 5,400,000
  const inwardTax = Math.round((inwardSubtotal * oilGstRate) / 100);
  const inwardExpectedTotal = inwardSubtotal + inwardTax + FREIGHT_PAISE;
  must(inward.purchase_bill.total_paise === inwardExpectedTotal, `Inward total expected ${inwardExpectedTotal} (subtotal + ${oilGstRate}% GST + freight), got ${inward.purchase_bill.total_paise}`);
  must(inward.purchase_bill.freight_paise === FREIGHT_PAISE, `Inward freight_paise expected ${FREIGHT_PAISE}, got ${inward.purchase_bill.freight_paise}`);
  step('Inward posted (Adani Wilmar Supply Co., 30 Cartons Fortune Oil + Rs.90 freight)', `GRN ${inward.purchase_bill.grn_no}, total ${rupees(inward.purchase_bill.total_paise)}`);

  const landedCostPerBase = Number(inward.batches[0].landed_cost_per_base_paise);
  const costPerBase = Number(inward.batches[0].cost_per_base_paise);
  must(landedCostPerBase > costPerBase, `Freight should raise landed cost above plain cost: landed=${landedCostPerBase}, cost=${costPerBase}`);
  step('Freight allocated into batch landed cost', `cost/pcs ${rupees(costPerBase)} -> landed cost/pcs ${rupees(landedCostPerBase)}`);

  const adaniLedgerAfterInward = await getSupplierLedger(suppliers.adani);
  must(
    adaniLedgerAfterInward.balance === adaniBalanceBefore + inwardExpectedTotal,
    `Adani AP should rise by ${inwardExpectedTotal} (freight-inclusive total), got delta ${adaniLedgerAfterInward.balance - adaniBalanceBefore}`
  );
  step('Supplier AP credit verified (freight-inclusive)', `Adani Wilmar payable now ${rupees(adaniLedgerAfterInward.balance)}`);

  // -------------------------------------------------------------------------
  section('STEP 3. Book 2 Wholesale Orders — Tiered Pricing');
  // -------------------------------------------------------------------------

  // Order A: 8 Cartons -> qty in [5,20) purchase-unit -> Tier-1 (Rs.120/pcs) should auto-apply.
  const orderA = await bookOrder(customers.kisan, [{ product_id: oil.documentId, entered_qty: '8', entered_unit: 'CARTON' }]);
  const orderAExpectedTotal = 8 * 15 * 12000; // 8 cartons x15 pcs x Tier-1 rate (tax-inclusive product, no GST added on top)
  must(Number(orderA.order.total_paise) === orderAExpectedTotal, `Order A total expected ${orderAExpectedTotal} (Tier-1 auto-applied), got ${orderA.order.total_paise}`);
  step('Order A booked (Kisan Super Mart): 8 Cartons Fortune Oil -> Tier-1 auto-applied', `total ${rupees(orderA.order.total_paise)}`);

  // Order B: 22 Cartons -> qty >= 20 purchase-unit -> Tier-2 (Rs.110/pcs) should auto-apply.
  const orderB = await bookOrder(customers.radhe, [{ product_id: oil.documentId, entered_qty: '22', entered_unit: 'CARTON' }]);
  const orderBExpectedTotal = 22 * 15 * 11000; // Tier-2 rate, cheaper per-pcs than Tier-1
  must(Number(orderB.order.total_paise) === orderBExpectedTotal, `Order B total expected ${orderBExpectedTotal} (Tier-2 auto-applied), got ${orderB.order.total_paise}`);
  step('Order B booked (Radhe Traders): 22 Cartons Fortune Oil -> Tier-2 auto-applied', `total ${rupees(orderB.order.total_paise)}`);

  must(orderA.customer_credit != null, 'Order A response missing customer_credit block (credit limit / outstanding balance)');
  must(orderB.customer_credit != null, 'Order B response missing customer_credit block');
  step('Customer credit limit + outstanding balance surfaced in booking response for both orders');

  // -------------------------------------------------------------------------
  section('STEP 4. Vehicle Assignment, Loading Sheet, Delivery Challan, DELIVERED');
  // -------------------------------------------------------------------------

  const orderIds = [orderA.order.document_id, orderB.order.document_id];
  const sheet = await loadingSheet(orderIds);
  const sheetLine = sheet.lines.find((l: any) => l.product_id === oil.documentId);
  must(!!sheetLine, 'Loading sheet missing the Fortune Oil aggregate line');
  const expectedAggregateBase = (8 + 22) * 15;
  must(Number(sheetLine.total_qty_base) === expectedAggregateBase, `Loading sheet aggregate expected ${expectedAggregateBase} pcs, got ${sheetLine.total_qty_base}`);
  step('Loading sheet generated', `${sheet.order_count} orders, Fortune Oil aggregate ${sheetLine.total_qty_base} pcs (${sheetLine.packing_qty_display} ${sheetLine.packing_unit})`);

  const dispatch = await dispatchOrders(orderIds, {
    vehicle_no: 'DL-01-AB-1234',
    transporter: 'Bharat Roadways',
    driver_name: 'Ramesh Kumar',
    freight_paise: 150000,
    freight_terms: 'TO_PAY_BY_CUSTOMER',
  });
  must(dispatch.vehicle_no === 'DL-01-AB-1234', `dispatch vehicle_no not persisted, got ${dispatch.vehicle_no}`);
  must(dispatch.transporter === 'Bharat Roadways', `dispatch transporter not persisted, got ${dispatch.transporter}`);
  must(dispatch.driver_name === 'Ramesh Kumar', `dispatch driver_name not persisted, got ${dispatch.driver_name}`);
  must(dispatch.freight_paise === 150000, `dispatch freight_paise not persisted, got ${dispatch.freight_paise}`);
  must(dispatch.freight_terms === 'TO_PAY_BY_CUSTOMER', `dispatch freight_terms not persisted, got ${dispatch.freight_terms}`);
  step('Orders dispatched — vehicle/transporter/driver/freight captured', `Challan ${dispatch.challan_no}, vehicle ${dispatch.vehicle_no}, freight ${rupees(dispatch.freight_paise)} (${dispatch.freight_terms})`);

  const kisanLedgerBeforeDelivery = await getCustomerLedger(customers.kisan);
  const radheLedgerBeforeDelivery = await getCustomerLedger(customers.radhe);
  const stockBeforeDelivery = await getProductStock(oil.documentId);

  const deliveredA = await deliverOrder(orderA.order.document_id);
  must(deliveredA.order.status === 'DELIVERED', `Order A expected DELIVERED, got ${deliveredA.order.status}`);
  const deliveredB = await deliverOrder(orderB.order.document_id);
  must(deliveredB.order.status === 'DELIVERED', `Order B expected DELIVERED, got ${deliveredB.order.status}`);
  step('Both orders marked DELIVERED', `Invoices ${deliveredA.order.invoice_no}, ${deliveredB.order.invoice_no}`);

  const stockAfterDelivery = await getProductStock(oil.documentId);
  const expectedStockDrop = expectedAggregateBase;
  must(stockBeforeDelivery - stockAfterDelivery === expectedStockDrop, `Stock should drop by ${expectedStockDrop} pcs on delivery, dropped by ${stockBeforeDelivery - stockAfterDelivery}`);
  step('Stock decremented on delivery', `Fortune Oil -${expectedStockDrop}pcs (${stockBeforeDelivery} -> ${stockAfterDelivery})`);

  const kisanLedgerAfterDelivery = await getCustomerLedger(customers.kisan);
  const radheLedgerAfterDelivery = await getCustomerLedger(customers.radhe);
  must(
    kisanLedgerAfterDelivery.balance === kisanLedgerBeforeDelivery.balance + Number(deliveredA.order.total_paise),
    'Kisan Super Mart ledger should increase by Order A total_paise on delivery'
  );
  must(
    radheLedgerAfterDelivery.balance === radheLedgerBeforeDelivery.balance + Number(deliveredB.order.total_paise),
    'Radhe Traders ledger should increase by Order B total_paise on delivery'
  );
  step('Invoice debits posted to both customers Khata', `Kisan +${rupees(Number(deliveredA.order.total_paise))}, Radhe +${rupees(Number(deliveredB.order.total_paise))}`);

  // -------------------------------------------------------------------------
  section('STEP 5. Customer Collection Settlement');
  // -------------------------------------------------------------------------

  const kisanBalanceBeforeSettlement = kisanLedgerAfterDelivery.balance;
  const SETTLEMENT_PAISE = 500000; // Rs.5000
  await recordCustomerPayment(customers.kisan, SETTLEMENT_PAISE, 'UPI', 'Wholesale collection');
  const kisanLedgerAfterSettlement = await getCustomerLedger(customers.kisan);
  must(
    kisanLedgerAfterSettlement.balance === kisanBalanceBeforeSettlement - SETTLEMENT_PAISE,
    `Kisan balance should drop by ${SETTLEMENT_PAISE}, got delta ${kisanLedgerAfterSettlement.balance - kisanBalanceBeforeSettlement}`
  );
  step('Customer collection recorded', `Kisan Super Mart paid ${rupees(SETTLEMENT_PAISE)} via UPI, balance now ${rupees(kisanLedgerAfterSettlement.balance)}`);

  // -------------------------------------------------------------------------
  section('STEP 6. Language Context + Theme Verification (real browser)');
  // -------------------------------------------------------------------------

  let uiCheck: { languageOk: boolean; themeOk: boolean; consoleErrors: string[] };
  try {
    uiCheck = await verifyLanguageAndTheme();
    must(uiCheck.languageOk, 'Language switch to Hindi did not update the sidebar nav label to डैशबोर्ड');
    must(uiCheck.themeOk, 'Theme switch to green did not update <html data-theme>');
    must(uiCheck.consoleErrors.length === 0, `Browser reported console/runtime errors: ${JSON.stringify(uiCheck.consoleErrors)}`);
    step('Language switcher verified in a real browser', 'clicking हिं updated the Dashboard nav label to "डैशबोर्ड" and back');
    step('Theme picker verified in a real browser', 'clicking "Kirana Forest Green" updated <html data-theme="green"> with no reload');
    step('No console or runtime errors observed during either interaction');
  } catch (err) {
    throw err;
  }

  // -------------------------------------------------------------------------
  section('STEP 7. Final Summary');
  // -------------------------------------------------------------------------

  const finalStock = await getProductStock(oil.documentId);
  const adaniLedgerFinal = await getSupplierLedger(suppliers.adani);
  const radheLedgerFinal = await getCustomerLedger(customers.radhe);

  const report = buildReport({
    storeName: session.storeName,
    inventory: [{ name: 'Fortune Mustard Oil', unit: 'pcs', finalStock }],
    supplierAP: [{ name: 'Adani Wilmar Supply Co.', closing: adaniLedgerFinal.balance }],
    customerAR: [
      { name: 'Kisan Super Mart', closing: kisanLedgerAfterSettlement.balance },
      { name: 'Radhe Traders', closing: radheLedgerFinal.balance },
    ],
    ui: uiCheck!,
  });

  const reportPath = path.join(SCRIPT_DIR, 'b2b-complete-flow-report.md');
  fs.writeFileSync(reportPath, report, 'utf8');
  console.log('\n' + report);
  console.log(`\n(Report also written to ${reportPath})`);
}

function buildReport(data: any): string {
  const lines: string[] = [];
  lines.push('# B2B Wholesale Engine — Combined Verification Summary');
  lines.push(`\nStore: **${data.storeName}** · Generated: ${new Date().toISOString()}\n`);

  lines.push('## Inventory');
  lines.push('| Product | Final Stock |');
  lines.push('|---|---|');
  for (const p of data.inventory) lines.push(`| ${p.name} | ${p.finalStock} ${p.unit} |`);

  lines.push('\n## Supplier AP Closing Balances');
  lines.push('| Supplier | Outstanding Payable |');
  lines.push('|---|---|');
  for (const s of data.supplierAP) lines.push(`| ${s.name} | ${rupees(s.closing)} |`);

  lines.push('\n## Customer AR Closing Balances');
  lines.push('| Customer | Outstanding Receivable |');
  lines.push('|---|---|');
  for (const c of data.customerAR) lines.push(`| ${c.name} | ${rupees(c.closing)} |`);

  lines.push('\n## UI/UX Verification (Part 1)');
  lines.push('| Check | Result |');
  lines.push('|---|---|');
  lines.push(`| Language switch (EN -> हिं) updates nav labels live | ${data.ui.languageOk ? 'PASS' : 'FAIL'} |`);
  lines.push(`| Theme switch updates \`<html data-theme>\` with no reload | ${data.ui.themeOk ? 'PASS' : 'FAIL'} |`);
  lines.push(`| Zero console/runtime errors during either interaction | ${data.ui.consoleErrors.length === 0 ? 'PASS' : `FAIL (${data.ui.consoleErrors.length} errors)`} |`);

  return lines.join('\n');
}

main().catch((err) => {
  console.error('\n❌ B2B COMPLETE FLOW TEST FAILED');
  console.error(err instanceof Error ? err.stack || err.message : err);
  process.exit(1);
});
