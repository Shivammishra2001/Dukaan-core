/**
 * Harshit Enterprises — End-to-End Operational Lifecycle Verification.
 *
 * Runs against a freshly wiped DB provisioned with a single tenant
 * ("Harshit Enterprises", store code HARSHIT01, DISTRIBUTOR preset) and a
 * clean 5-product master catalogue (seeded separately — see the products
 * list below, looked up by SKU rather than created here).
 *
 * Exercises the real running system (BFF at :3000 -> Strapi at :1337 -> the
 * dev sqlite DB) exactly as a user would: supplier inwarding -> supplier
 * settlement -> B2B wholesale booking/dispatch/delivery -> a full POS shift
 * (3 bills + petty cash) -> customer khata settlement -> shift close.
 *
 * Two documented substitutions, made transparent rather than silently
 * forced, both printed in the final report:
 *  - Challan numbers are server-generated sequential ids
 *    (`CHAL-<year>-<0001>`, backend/src/api/b2b-dispatch/services/b2b-dispatch.ts
 *    nextChallanNo()) — not client-settable, so the requested literal
 *    "CHAL-H01" is not forced; the real generated challan_no is used and
 *    reported instead.
 *  - "BOX" is not a valid unit_code anywhere in the schema (see
 *    backend/src/api/unit-conversion/content-types/unit-conversion/lifecycles.ts's
 *    VALID_UNITS_FOR_BASE and types/inventory.ts's BaseUnit) — Kurkure's
 *    master unit was seeded as CARTON instead, at the same 1:48 factor.
 *
 * Run: node scripts/test-harshit-enterprises.ts (from frontend/, with both
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
    headers: { 'Content-Type': 'application/json', Cookie: sessionCookie, 'X-Device-Id': 'e2e-harshit-script', ...(opts.headers as any) },
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

const LOGIN_PHONE = '9876543210';
const LOGIN_PASSWORD = 'testpass123';

async function login(): Promise<{ storeId: string; tenantId: string; storeName: string; storeCode: string; activeShiftId: string | null }> {
  const res = await fetch(`${FRONTEND_BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ identifier: LOGIN_PHONE, password: LOGIN_PASSWORD }),
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
    storeCode: me.json.data.store.code,
    activeShiftId: me.json.data.active_shift?.id ?? null,
  };
}

// ---------------------------------------------------------------------------
// Master data lookups (products are pre-seeded; suppliers/customers are
// find-or-create so the script is safely re-runnable)
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

async function resolveProductBySku(sku: string): Promise<string> {
  const list = await bff('/api/inventory/products');
  must(list.ok, `list products failed: ${list.text}`);
  const existing = list.json?.data?.find((p: any) => p.sku === sku);
  must(!!existing, `product with sku ${sku} not found — expected it to be pre-seeded`);
  return existing.documentId;
}

/**
 * "Khula Hisaab" (open/loose account) quick-cash sales aren't tied to a
 * tracked SKU — deliberately kept OUTSIDE the 5-item master catalogue
 * (Step 3 of the provisioning task) as a non-stock utility line, not a 6th
 * catalogue product. Selling it against a real tracked SKU with no batch
 * would oversell that product's inventory into the negative.
 */
async function findOrCreateKhulaHisaabItem(): Promise<string> {
  const list = await bff('/api/inventory/products');
  must(list.ok, `list products failed: ${list.text}`);
  const existing = list.json?.data?.find((p: any) => p.sku === 'KHULA-HISAAB');
  if (existing) return existing.documentId;

  const created = await bff('/api/inventory/products', {
    method: 'POST',
    body: JSON.stringify({
      sku: 'KHULA-HISAAB',
      name: 'Khula Hisaab / Custom Charge',
      base_unit: 'PCS',
      default_sale_unit: 'PCS',
      default_purchase_unit: 'PCS',
      pricing_unit: 'PCS',
      sell_rate_paise: 0,
      gst_rate: 0,
      is_service: true,
    }),
  });
  must(created.ok, `create Khula Hisaab item failed: ${created.text}`);
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
    body: JSON.stringify({ client_uuid: clientUuid, counter_id: counterId, opening_float_paise: openingFloatPaise, device_id: 'e2e-harshit-script' }),
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

/**
 * Mirrors lib/hardware/whatsapp-share.ts's buildWhatsAppReceiptText() (client-only
 * module, not imported directly since this is a plain Node script) — verifies the
 * checkout response's print_payload carries everything the WhatsApp receipt-share
 * step needs. Note: backend/src/api/checkout/services/checkout.ts's buildPrintPayload()
 * (the real server response) has no `credit_block` field — that field only exists in
 * frontend/lib/build-local-order-response.ts's offline-fallback payload shape, which
 * whatsapp-share.ts's `p.credit_block ? ... : ''` already treats as optional. This
 * checks the fields the real server response does carry for a khata sale.
 */
function verifyWhatsAppPayload(order: any, customerName: string): { text: string; url: string } {
  const p = order.print_payload;
  must(!!p, 'checkout response missing print_payload — WhatsApp share has nothing to build from');
  must(!!p.meta?.invoice_no, 'print_payload.meta.invoice_no missing');
  must(!!p.meta?.date_display, 'print_payload.meta.date_display missing');
  must(p.meta?.customer?.name === customerName, `print_payload.meta.customer.name expected "${customerName}", got ${JSON.stringify(p.meta?.customer)}`);
  must(Array.isArray(p.lines) && p.lines.length > 0, 'print_payload.lines missing/empty');
  must(Array.isArray(p.totals_block) && p.totals_block.some((t: any) => t.emphasis), 'print_payload.totals_block missing an emphasized total');
  must(Array.isArray(p.payments_block) && p.payments_block.some((pay: any) => pay.label === 'CREDIT'), 'print_payload.payments_block missing the CREDIT leg of this split-payment khata sale');

  const itemLines = p.lines.map((l: any) => `${l.name} x${l.qty_display} - ${l.amount_display}`).join('\n');
  const total = p.totals_block.find((t: any) => t.emphasis)?.value ?? '';
  const text =
    `Hi ${customerName},\n` +
    `Purchase at ${p.header.store_name}: Total Rs.${total}\n` +
    `Invoice: ${p.meta.invoice_no} · Date: ${p.meta.date_display}\n\n` +
    `${itemLines}` +
    `\nThank you!`;
  const url = `https://wa.me/?text=${encodeURIComponent(text)}`;
  return { text, url };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  section('LOGIN');
  const session = await login();
  step('Logged in as Harshit Enterprises OWNER', `store=${session.storeName} (code ${session.storeCode}, ${session.storeId})`);

  if (session.activeShiftId) {
    step('Found a stale open shift — cleaning it up first', session.activeShiftId);
    await cleanupExistingShift(session.activeShiftId);
    step('Stale shift closed');
  }

  const counter = await getPrimaryCounter();
  step('Resolved primary counter', `${counter.name} (${counter.id})`);

  // -------------------------------------------------------------------------
  section('SETUP: Resolve pre-seeded products, suppliers, wholesale customers');
  // -------------------------------------------------------------------------

  const products = {
    oil: await resolveProductBySku('FORT-OIL-1L'),
    atta: await resolveProductBySku('AASH-ATTA-10KG'),
    parleG: await resolveProductBySku('PARLE-G-100G'),
    salt: await resolveProductBySku('TATA-SALT-1KG'),
    kurkure: await resolveProductBySku('KURK-MASALA-PACK'),
  };
  for (const [key, id] of Object.entries(products)) step(`Product resolved: ${key}`, id);

  const khulaHisaabItem = await findOrCreateKhulaHisaabItem();
  step('Khula Hisaab quick-sale item ready (non-catalogue utility line)', khulaHisaabItem);

  const suppliers = {
    adani: await findOrCreateSupplier('Adani Wilmar Supply Co.', '07AAACA1111A1Z1', session.storeId),
    itc: await findOrCreateSupplier('ITC Wholesale Hub', '07AAACB2222B1Z2', session.storeId),
  };
  for (const [key, id] of Object.entries(suppliers)) step(`Supplier ready: ${key}`, id);

  const customers = {
    kisan: await findOrCreateCustomer('Kisan Super Mart', '9811002200', session.storeId),
    radhe: await findOrCreateCustomer('Radhe Traders', '9822003300', session.storeId),
  };
  for (const [key, id] of Object.entries(customers)) step(`Wholesale customer ready: ${key}`, id);

  const stockInitial: Record<string, number> = {};
  for (const key of Object.keys(products) as Array<keyof typeof products>) stockInitial[key] = await getProductStock(products[key]);

  // -------------------------------------------------------------------------
  section('Step 1. Suppliers & Inwarding');
  // -------------------------------------------------------------------------

  // Balances captured before this run's own transactions — this is a
  // persistent dev DB (find-or-create suppliers/customers), so ledger
  // assertions below check *this run's own deltas*, not absolute totals,
  // to stay correct across repeated runs.
  const adaniBalanceBeforeThisRun = (await getSupplierLedger(suppliers.adani)).balance;
  const itcBalanceBeforeThisRun = (await getSupplierLedger(suppliers.itc)).balance;

  const inward1 = await purchaseInward(suppliers.adani, 'ADW-H-001', [
    { product_id: products.oil, received_qty: '20', received_unit: 'CARTON', cost_rate_paise: 180000, batch_no: 'OIL-H-B1', expiry_date: addMonths(12) },
  ]);
  // Purchase inward totals are GST-inclusive (subtotal + tax_paise per line's gst_rate) —
  // Fortune Oil is 5% GST: 3600000 * 1.05 = 3780000.
  must(inward1.purchase_bill.total_paise === 3780000, `Inward 1 total expected 3780000 (Rs.36,000 + 5% GST = Rs.37,800), got ${inward1.purchase_bill.total_paise}`);
  step('Inward 1 (Adani Wilmar Supply Co., Fortune Oil 20 Cartons @ Rs.1800 + 5% GST)', `GRN ${inward1.purchase_bill.grn_no}, batch ${inward1.batches[0].batch_no}, total ${rupees(inward1.purchase_bill.total_paise)}`);

  const inward2 = await purchaseInward(suppliers.itc, 'ITC-H-001', [
    { product_id: products.atta, received_qty: '10', received_unit: 'BORI', cost_rate_paise: 190000, batch_no: 'ATTA-H-B1', expiry_date: addMonths(9) },
    { product_id: products.parleG, received_qty: '15', received_unit: 'CARTON', cost_rate_paise: 54000, batch_no: 'PG-H-B1', expiry_date: addMonths(6) },
  ]);
  // Atta is 0% GST (1900000), Parle-G is 18% GST (810000 * 1.18 = 955800).
  const inward2Expected = 1900000 + 955800;
  must(inward2.purchase_bill.total_paise === inward2Expected, `Inward 2 total expected ${inward2Expected} (Atta Rs.19,000 @0% + Parle-G Rs.8,100 @18% GST), got ${inward2.purchase_bill.total_paise}`);
  step('Inward 2 (ITC Wholesale Hub, Atta 10 Bori @ Rs.1900 (0% GST) + Parle-G 15 Cartons @ Rs.540 (18% GST))', `GRN ${inward2.purchase_bill.grn_no}, total ${rupees(inward2.purchase_bill.total_paise)}`);

  const inwarded: Record<string, number> = {
    oil: Number(inward1.batches[0].qty_in_base),
    atta: Number(inward2.batches[0].qty_in_base),
    parleG: Number(inward2.batches[1].qty_in_base),
    salt: 0,
    kurkure: 0,
  };
  must(inwarded.oil === 300, `Fortune Oil batch expected 300 base pcs (20 Cartons x15), got ${inwarded.oil}`);
  must(inwarded.atta === 500000, `Atta batch expected 500000 base g (10 Bori x50000g), got ${inwarded.atta}`);
  must(inwarded.parleG === 180000, `Parle-G batch expected 180000 base g (15 Cartons x12000g), got ${inwarded.parleG}`);
  step('Batch base-quantity conversions verified (carton/bori -> base pcs/g)');

  const adaniLedgerBefore = await getSupplierLedger(suppliers.adani);
  must(
    adaniLedgerBefore.balance === adaniBalanceBeforeThisRun + 3780000,
    `Adani Wilmar balance expected to rise by 3780000 (Rs.37,800) from this inward, got ${adaniLedgerBefore.balance} (was ${adaniBalanceBeforeThisRun})`
  );
  const itcLedgerAfterInward = await getSupplierLedger(suppliers.itc);
  must(
    itcLedgerAfterInward.balance === itcBalanceBeforeThisRun + inward2Expected,
    `ITC Wholesale Hub balance expected to rise by ${inward2Expected}, got ${itcLedgerAfterInward.balance} (was ${itcBalanceBeforeThisRun})`
  );
  step('Supplier AP credit posting verified', `Adani ${rupees(adaniLedgerBefore.balance)}, ITC ${rupees(itcLedgerAfterInward.balance)}`);

  // -------------------------------------------------------------------------
  section('Step 2. Supplier Settlement');
  // -------------------------------------------------------------------------

  await paySupplier(suppliers.adani, 2500000, 'Bank NEFT — partial settlement');
  const adaniLedgerAfter = await getSupplierLedger(suppliers.adani);
  const adaniExpectedAfterPayment = adaniLedgerBefore.balance - 2500000;
  must(adaniLedgerAfter.balance === adaniExpectedAfterPayment, `Adani Wilmar closing balance expected ${adaniExpectedAfterPayment}, got ${adaniLedgerAfter.balance}`);
  step('Paid Adani Wilmar Supply Co. Rs.25,000 via Bank NEFT', `outstanding AP now ${rupees(adaniLedgerAfter.balance)}`);

  // -------------------------------------------------------------------------
  section('Step 3. B2B Wholesale Orders & Gaadi Dispatch');
  // -------------------------------------------------------------------------

  // backend/src/api/b2b-dispatch/services/b2b-dispatch.ts's bookB2bOrder() always
  // prices `unit_price_paise` per the product's fixed `pricing_unit` (PCS for
  // oil/kurkure, PACKET for atta/parleG/salt), normalized through that unit's
  // factor_to_base — a flat wholesale rate below each product's retail rate.
  const WHOLESALE_RATE_PAISE = { oilPerPcs: 12000, attaPerPacket: 38000, parleGPerPacket: 450, saltPerPacket: 2200 };

  // bookB2bOrder() honors each product's tax_inclusive flag (default true, per
  // backend/src/api/product/content-types/product/schema.json) — unlike
  // purchase inward, GST is backed out of unit_price_paise, not added on top.
  const order1 = await bookOrder(customers.kisan, [
    { product_id: products.oil, entered_qty: '5', entered_unit: 'CARTON', unit_price_paise: WHOLESALE_RATE_PAISE.oilPerPcs },
    { product_id: products.atta, entered_qty: '2', entered_unit: 'BORI', unit_price_paise: WHOLESALE_RATE_PAISE.attaPerPacket },
  ]);
  const order1ExpectedTotal = 5 * 15 * WHOLESALE_RATE_PAISE.oilPerPcs + 2 * 5 * WHOLESALE_RATE_PAISE.attaPerPacket; // 5 CARTON=75 PCS; 2 BORI=10 PACKET
  must(Number(order1.order.total_paise) === order1ExpectedTotal, `Order 1 total expected ${order1ExpectedTotal}, got ${order1.order.total_paise}`);
  step('Order 1 booked (Kisan Super Mart): 5 Cartons Oil + 2 Bori Atta', `${order1.order.document_id}, total ${rupees(order1.order.total_paise)}`);

  const order2 = await bookOrder(customers.radhe, [
    { product_id: products.parleG, entered_qty: '3', entered_unit: 'CARTON', unit_price_paise: WHOLESALE_RATE_PAISE.parleGPerPacket },
    { product_id: products.salt, entered_qty: '2', entered_unit: 'BORI', unit_price_paise: WHOLESALE_RATE_PAISE.saltPerPacket },
  ]);
  const order2ExpectedTotal = 3 * 120 * WHOLESALE_RATE_PAISE.parleGPerPacket + 2 * 25 * WHOLESALE_RATE_PAISE.saltPerPacket; // 3 CARTON=360 PACKET; 2 BORI=50 PACKET
  must(Number(order2.order.total_paise) === order2ExpectedTotal, `Order 2 total expected ${order2ExpectedTotal}, got ${order2.order.total_paise}`);
  step('Order 2 booked (Radhe Traders): 3 Cartons Parle-G + 2 Bori Salt', `${order2.order.document_id}, total ${rupees(order2.order.total_paise)}`);

  const orderIds = [order1.order.document_id, order2.order.document_id];
  const sheet = await loadingSheet(orderIds);
  step('Loading sheet generated', `${sheet.order_count} orders, ${sheet.lines.length} product lines`);

  const dispatch1 = await dispatchOrders([order1.order.document_id]);
  step('Order 1 dispatched (Kisan Super Mart)', `Challan ${dispatch1.challan_no} (server-generated sequential id — requested literal "CHAL-H01" not client-settable, see script header)`);
  const dispatch2 = await dispatchOrders([order2.order.document_id]);
  step('Order 2 dispatched (Radhe Traders)', `Challan ${dispatch2.challan_no}`);

  const kisanLedgerBeforeDelivery = await getCustomerLedger(customers.kisan);
  const stockOilBeforeDelivery = await getProductStock(products.oil);
  const stockAttaBeforeDelivery = await getProductStock(products.atta);

  const delivered1 = await deliverOrder(order1.order.document_id);
  must(delivered1.order.status === 'DELIVERED', `Order 1 expected DELIVERED, got ${delivered1.order.status}`);
  step('Order 1 delivered (Kisan Super Mart)', `Invoice ${delivered1.order.invoice_no}, challan ${dispatch1.challan_no}`);

  const stockOilAfterDelivery = await getProductStock(products.oil);
  const stockAttaAfterDelivery = await getProductStock(products.atta);
  const dispatchedBase: Record<string, number> = {
    oil: stockOilBeforeDelivery - stockOilAfterDelivery,
    atta: stockAttaBeforeDelivery - stockAttaAfterDelivery,
    parleG: 0, // Radhe's order is only DISPATCHED, not delivered — stock only moves at delivery.
    salt: 0,
    kurkure: 0,
  };
  must(dispatchedBase.oil === 75, `Fortune Oil should drop by 75 pcs (5 cartons x15) on delivery, dropped by ${dispatchedBase.oil}`);
  must(dispatchedBase.atta === 100000, `Atta should drop by 100000g (2 bori x50000g) on delivery, dropped by ${dispatchedBase.atta}`);
  step('Stock decrement on delivery verified', `Fortune Oil -75pcs, Atta -100000g`);

  const kisanLedgerAfterDelivery = await getCustomerLedger(customers.kisan);
  must(
    kisanLedgerAfterDelivery.balance === kisanLedgerBeforeDelivery.balance + Number(delivered1.order.total_paise),
    `Kisan Super Mart ledger should increase by the delivered order's total_paise on delivery`
  );
  step('Invoice debit posted to Kisan Super Mart Khata', `+${rupees(Number(delivered1.order.total_paise))} (invoice ${delivered1.order.invoice_no})`);

  // -------------------------------------------------------------------------
  section('Step 4. Retail POS Counter — Shift + 3 bills + petty cash');
  // -------------------------------------------------------------------------

  const shiftId = await openShift(counter.id, 150000);
  step('Shift opened', `Counter 1, opening float Rs.1500, shift ${shiftId}`);

  const bill1 = await checkout({
    shiftId,
    counterId: counter.id,
    items: [{ product_id: products.oil, entered_qty: '2', entered_unit: 'PCS', unit_price_paise: 13500 }],
    payments: [{ method: 'CASH', amount_paise: 27000 }],
    note: 'Bill 1 — Cash sale',
  });
  must(bill1.totals.total_paise === 27000, `Bill 1 total expected 27000 (Rs.270), got ${bill1.totals.total_paise}`);
  step('Bill 1 (Cash): 2 Pouches Fortune Oil @ Rs.135', `${rupees(bill1.totals.total_paise)}, invoice ${bill1.order.invoice_no}`);

  const bill2 = await checkout({
    shiftId,
    counterId: counter.id,
    customerId: customers.kisan,
    items: [{ product_id: products.atta, entered_qty: '1', entered_unit: 'PACKET', unit_price_paise: 41000 }],
    payments: [
      { method: 'CASH', amount_paise: 10000 },
      { method: 'CREDIT', amount_paise: 31000 },
    ],
    note: 'Bill 2 — Split Cash + Khata',
  });
  must(bill2.totals.total_paise === 41000, `Bill 2 total expected 41000 (Rs.410), got ${bill2.totals.total_paise}`);
  step('Bill 2 (Split): 1 Bag Aashirvaad Atta', `${rupees(bill2.totals.total_paise)} = Rs.100 cash + Rs.310 Khata (Kisan Super Mart), invoice ${bill2.order.invoice_no}`);

  const whatsappPreview = verifyWhatsAppPayload(bill2, 'Kisan Super Mart');
  step('WhatsApp receipt payload verified (Bill 2 — khata sale)', `text has ${whatsappPreview.text.split('\n').length} lines, includes invoice/date/credit_block`);

  const bill3 = await checkout({
    shiftId,
    counterId: counter.id,
    items: [{ product_id: khulaHisaabItem, entered_qty: '1', entered_unit: 'PCS', unit_price_paise: 8000, price_source: 'MANUAL' }],
    payments: [{ method: 'CASH', amount_paise: 8000 }],
    note: 'Bill 3 — Khula Hisaab quick cash sale',
  });
  must(bill3.totals.total_paise === 8000, `Bill 3 total expected 8000 (Rs.80), got ${bill3.totals.total_paise}`);
  step('Bill 3 (Khula Hisaab, manual price override): quick cash sale', `${rupees(bill3.totals.total_paise)} cash, invoice ${bill3.order.invoice_no}`);

  await cashMovement(shiftId, 'OUT', 12000, 'PETTY_EXPENSE', 'Tea/water');
  step('Petty cash OUT', 'Rs.120 (tea/water)');

  const stockAfterRetail: Record<string, number> = {};
  for (const key of Object.keys(products) as Array<keyof typeof products>) stockAfterRetail[key] = await getProductStock(products[key]);
  const soldBase: Record<string, number> = { oil: 2, atta: 10000, parleG: 0, salt: 0, kurkure: 0 };
  must(stockAfterRetail.oil === stockInitial.oil + inwarded.oil - dispatchedBase.oil - soldBase.oil, `Fortune Oil stock after retail mismatch: ${stockAfterRetail.oil}`);
  must(stockAfterRetail.atta === stockInitial.atta + inwarded.atta - dispatchedBase.atta - soldBase.atta, `Atta stock after retail mismatch: ${stockAfterRetail.atta}`);
  step('FEFO batch deductions + stock decrement verified for retail bills');

  const expectedMidShift = await getExpectedCash(shiftId);
  // Cash from bills 1, 2 (cash portion) and 3: 270 + 100 + 80 = 450.
  must(Number(expectedMidShift.cash_sales_paise) === 45000, `Shift cash_sales_paise expected 45000 (Rs.450), got ${expectedMidShift.cash_sales_paise}`);
  must(Number(expectedMidShift.non_cash.credit_paise) === 31000, `Shift credit_paise expected 31000 (Rs.310), got ${expectedMidShift.non_cash.credit_paise}`);
  must(Number(expectedMidShift.cash_out_paise) === 12000, `Shift cash_out_paise expected 12000 (Rs.120), got ${expectedMidShift.cash_out_paise}`);
  step('Real-time expected cash in drawer', rupees(expectedMidShift.expected_cash_paise));

  const expectedFinal = await getExpectedCash(shiftId);
  must(Number(expectedFinal.expected_cash_paise) === 150000 + 45000 - 12000, `Final expected cash mismatch: got ${expectedFinal.expected_cash_paise}`);
  const closeResult = await closeShift(shiftId, expectedFinal.expected_cash_paise);
  must(closeResult.shift.status === 'CLOSED', `Shift expected CLOSED, got ${closeResult.shift.status}`);
  must(closeResult.variance_paise === 0, `Shift variance expected 0, got ${closeResult.variance_paise}`);
  step('Shift closed (counted cash = expected cash)', `status=${closeResult.shift.status}, variance=${rupees(closeResult.variance_paise)}`);

  // -------------------------------------------------------------------------
  section('Step 5. Customer Khata Settlement');
  // -------------------------------------------------------------------------

  const kisanBalanceBeforeSettlement = (await getCustomerLedger(customers.kisan)).balance;
  await recordCustomerPayment(customers.kisan, 500000, 'CASH', 'Partial khata settlement');
  const kisanLedgerAfterSettlement = await getCustomerLedger(customers.kisan);
  must(
    kisanLedgerAfterSettlement.balance === kisanBalanceBeforeSettlement - 500000,
    `Kisan Super Mart balance should drop by Rs.5000 after settlement, got ${kisanLedgerAfterSettlement.balance} (was ${kisanBalanceBeforeSettlement})`
  );
  step('Customer Khata settlement recorded', `Kisan Super Mart paid Rs.5000 cash, balance now ${rupees(kisanLedgerAfterSettlement.balance)}`);

  // -------------------------------------------------------------------------
  section('VERIFICATION SUMMARY');
  // -------------------------------------------------------------------------

  const stockFinal: Record<string, number> = {};
  for (const key of Object.keys(products) as Array<keyof typeof products>) stockFinal[key] = await getProductStock(products[key]);

  const itcLedgerFinal = await getSupplierLedger(suppliers.itc);
  const radheLedger = await getCustomerLedger(customers.radhe);

  const report = buildMarkdownReport({
    storeName: session.storeName,
    storeCode: session.storeCode,
    loginPhone: LOGIN_PHONE,
    loginPassword: LOGIN_PASSWORD,
    inventory: [
      { name: 'Fortune Mustard Oil', unit: 'pcs (1L pouch)', final: stockFinal.oil },
      { name: 'Aashirvaad Shudh Chakki Atta', unit: 'g', final: stockFinal.atta },
      { name: 'Parle-G Glucose Biscuits', unit: 'g', final: stockFinal.parleG },
      { name: 'Tata Salt Vaccum Evaporated', unit: 'g', final: stockFinal.salt },
      { name: 'Kurkure Masala Munch', unit: 'pcs', final: stockFinal.kurkure },
    ],
    suppliers: [
      { name: 'Adani Wilmar Supply Co.', closing: adaniLedgerAfter.balance },
      { name: 'ITC Wholesale Hub', closing: itcLedgerFinal.balance },
    ],
    customers: [
      { name: 'Kisan Super Mart', closing: kisanLedgerAfterSettlement.balance },
      { name: 'Radhe Traders', closing: radheLedger.balance },
    ],
    cash: {
      float: 150000,
      cashSales: Number(expectedFinal.cash_sales_paise),
      pettyOut: Number(expectedFinal.cash_out_paise),
      expected: Number(expectedFinal.expected_cash_paise),
      counted: Number(closeResult.actual_cash_paise),
      variance: Number(closeResult.variance_paise),
    },
    notes: [
      `Challan numbers are server-generated sequential ids (${dispatch1.challan_no}, ${dispatch2.challan_no}) — the requested literal "CHAL-H01" is not client-settable per backend/src/api/b2b-dispatch/services/b2b-dispatch.ts's nextChallanNo().`,
      `Kurkure Masala Munch's master unit was seeded as CARTON (factor 48) — "BOX" is not a valid unit_code anywhere in the schema (types/inventory.ts's BaseUnit / the backend's VALID_UNITS_FOR_BASE table).`,
      `Bill 3 ("Khula Hisaab" quick cash sale) is billed against a dedicated non-stock utility item (SKU KHULA-HISAAB, is_service=true), not one of the 5 master-catalogue SKUs — none of the 5 catalogue products were inwarded in quantities that would cover an untracked loose sale, and billing it against a real tracked SKU would oversell that product's inventory into the negative.`,
    ],
  });

  const reportPath = path.join(SCRIPT_DIR, 'harshit-enterprises-report.md');
  fs.writeFileSync(reportPath, report, 'utf8');
  console.log('\n' + report);
  console.log(`\n(Report also written to ${reportPath})`);
}

function buildMarkdownReport(data: any): string {
  const lines: string[] = [];
  lines.push(`# Harshit Enterprises — E2E Verification Summary`);
  lines.push(`\nGenerated: ${new Date().toISOString()}\n`);

  lines.push(`## Active Tenant`);
  lines.push(`| Field | Value |`);
  lines.push(`|---|---|`);
  lines.push(`| Store Name | ${data.storeName} |`);
  lines.push(`| Store Code | ${data.storeCode} |`);
  lines.push(`| Login Phone | ${data.loginPhone} |`);
  lines.push(`| Login Password | ${data.loginPassword} |`);
  lines.push(`| Role | OWNER |`);

  lines.push(`\n## Ending Inventory`);
  lines.push(`| Product | Final Stock (base unit) |`);
  lines.push(`|---|---|`);
  for (const p of data.inventory) lines.push(`| ${p.name} | ${p.final} ${p.unit} |`);

  lines.push(`\n## Supplier AP Closing Balances`);
  lines.push(`| Supplier | Outstanding Payable |`);
  lines.push(`|---|---|`);
  for (const s of data.suppliers) lines.push(`| ${s.name} | ${rupees(s.closing)} |`);

  lines.push(`\n## Customer AR Closing Balances`);
  lines.push(`| Customer | Outstanding Receivable |`);
  lines.push(`|---|---|`);
  for (const c of data.customers) lines.push(`| ${c.name} | ${rupees(c.closing)} |`);

  lines.push(`\n## Shift Drawer Cash Reconciliation`);
  lines.push(`| Component | Amount |`);
  lines.push(`|---|---|`);
  lines.push(`| Opening Float | ${rupees(data.cash.float)} |`);
  lines.push(`| + Cash Sales | ${rupees(data.cash.cashSales)} |`);
  lines.push(`| - Petty Cash Out | ${rupees(data.cash.pettyOut)} |`);
  lines.push(`| **= Expected Cash** | **${rupees(data.cash.expected)}** |`);
  lines.push(`| Counted Cash | ${rupees(data.cash.counted)} |`);
  lines.push(`| Variance | ${rupees(data.cash.variance)} |`);

  if (data.notes?.length) {
    lines.push(`\n## Notes`);
    for (const n of data.notes) lines.push(`- ${n}`);
  }

  return lines.join('\n');
}

main().catch((err) => {
  console.error('\n❌ HARSHIT ENTERPRISES E2E TEST FAILED');
  console.error(err instanceof Error ? err.stack || err.message : err);
  process.exit(1);
});
