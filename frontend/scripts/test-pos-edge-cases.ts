/**
 * Verifies three POS fixes, per store (Harshit Enterprises, and the
 * "Scope Test Kirana" store created by test-session-scope.ts):
 *   1. Cashier attribution — the shift and the invoice carry the signed-in
 *      user (the BFF now forwards X-Cashier-Id), not "System Cashier"; a
 *      second Open Shift on the same counter is refused (Rule SH-1), which
 *      SQLite dev databases previously didn't enforce.
 *   2. Shift hydration — after a hard reload (F5) the POS resumes the open
 *      shift (billing screen) instead of offering "Open Shift".
 *   3. Invoice numbers — `PREFIX/YYYY-YY/COUNTER/NNNNNN`, never `null/...`.
 * Closes the shifts it opens. Needs frontend :3000 and backend :1337 running.
 * Run: node scripts/test-pos-edge-cases.ts
 */
import { chromium, type Browser, type Page } from 'playwright';

const BASE = 'http://localhost:3000';
const STORES = [
  { label: 'Harshit Enterprises', phone: '9876543210', password: 'testpass123' },
  { label: 'Scope Test Kirana', phone: '9000000001', password: 'testpass123', expectedPrefix: 'STK' },
];
const INVOICE_FORMAT = /^[A-Z0-9-]{1,10}\/\d{4}-\d{2}\/C\d+\/\d{6}$/;

function must(cond: unknown, message: string): asserts cond {
  if (!cond) throw new Error(`ASSERTION FAILED: ${message}`);
}

async function apiLogin(phone: string, password: string): Promise<string> {
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ identifier: phone, password }),
  });
  must(res.ok, `login ${phone} failed: ${res.status}`);
  const cookie = res.headers.getSetCookie().find((c) => c.startsWith('dukaan_session='));
  must(cookie, 'no session cookie');
  return cookie.split(';')[0];
}

async function bff(cookie: string, path: string, init: RequestInit = {}) {
  const res = await fetch(`${BASE}${path}`, { ...init, headers: { 'Content-Type': 'application/json', Cookie: cookie, ...(init.headers as Record<string, string>) } });
  const text = await res.text();
  let json: any = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* non-JSON */
  }
  return { ok: res.ok, status: res.status, json, text };
}

/** Closes every OPEN shift the POS would resume for this user (own, then legacy placeholder ones). */
async function closeOpenShifts(cookie: string, reason: string) {
  for (let i = 0; i < 10; i++) {
    const active = await bff(cookie, '/api/pos/shifts/active');
    const shiftId = active.json?.data?.id;
    if (!shiftId) return;
    const expected = await bff(cookie, `/api/shifts/${shiftId}/expected`);
    const res = await bff(cookie, `/api/shifts/${shiftId}/close`, {
      method: 'POST',
      body: JSON.stringify({
        denomination_count: { coins_paise: Math.max(0, Number(expected.json?.data?.expected_cash_paise ?? 0)) },
        variance_reason_code: 'OTHER',
        variance_reason_text: reason,
        approval_token: 'e2e-cleanup',
      }),
    });
    must(res.ok, `could not close shift ${shiftId}: ${res.text}`);
  }
}

/**
 * Adds one sellable item to the cart. Tries in-stock catalogue rows in order
 * (some may be refused, e.g. a selling rate above MRP), then — for a store
 * with no stock yet, where catalogue Add is disabled — a whole-unit loose
 * Quick Grid chip (1kg / 1L).
 */
async function addOneItem(page: Page) {
  const cartEmpty = page.getByText('Cart is empty');
  const added = async () => {
    await page.waitForTimeout(300);
    return !(await cartEmpty.isVisible().catch(() => false));
  };
  await page.getByRole('button', { name: /Search & Catalog/ }).click();
  const addButtons = page.locator('button:not([disabled])', { hasText: /^Add$/ });
  const count = await addButtons.count();
  for (let i = 0; i < count; i++) {
    await addButtons.nth(i).click();
    if (await added()) return;
  }
  await page.getByRole('button', { name: /Quick Grid/ }).click();
  await page.locator('button:not([disabled])', { hasText: /^1(kg|L)$/ }).first().click();
  must(await added(), 'could not add any item to the cart');
}

async function verifyStore(browser: Browser, store: (typeof STORES)[number]) {
  const cookie = await apiLogin(store.phone, store.password);
  const me = (await bff(cookie, '/api/auth/me')).json.data;
  const userName: string = me.user.full_name;
  await closeOpenShifts(cookie, 'edge-case test pre-flight');

  const context = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
  await context.addCookies([{ name: 'dukaan_session', value: cookie.split('=')[1], url: BASE }]);
  const page = await context.newPage();
  const pageErrors: string[] = [];
  page.on('pageerror', (err) => pageErrors.push(err.message));
  const checkouts: Array<{ status: number; body: any }> = [];
  page.on('response', async (res) => {
    if (res.url().includes('/api/pos/checkout')) checkouts.push({ status: res.status(), body: await res.json().catch(() => null) });
  });

  try {
    // 1. Open a shift through the UI; it must be attributed to the signed-in user.
    await page.goto(`${BASE}/pos`, { waitUntil: 'networkidle' });
    await page.getByRole('button', { name: /Open Shift/ }).click();
    await page.getByPlaceholder(/Scan barcode/).waitFor({ timeout: 10000 });
    const active = (await bff(cookie, '/api/pos/shifts/active')).json?.data;
    must(active, 'no active shift after opening one');
    must(active.user.full_name === userName, `shift attributed to "${active.user.full_name}", expected "${userName}"`);
    const again = await bff(cookie, '/api/shifts/open', {
      method: 'POST',
      headers: { 'Idempotency-Key': crypto.randomUUID() },
      body: JSON.stringify({ client_uuid: crypto.randomUUID(), counter_id: active.counter.id, opening_float_paise: 0, device_id: 'edge-case-test' }),
    });
    must(again.status === 422 && again.json?.error?.code === 'ERR_SHIFT_ALREADY_OPEN_COUNTER', `second open on the same counter should be 422 ERR_SHIFT_ALREADY_OPEN_COUNTER, got ${again.status} ${again.text}`);
    console.log(`  shift opened by "${active.user.full_name}"; second open on ${active.counter.code} -> ${again.status} ${again.json.error.code}`);

    // 2. Hard reload: the POS must resume the shift, not offer Open Shift.
    await page.reload({ waitUntil: 'networkidle' });
    await page.getByPlaceholder(/Scan barcode/).waitFor({ timeout: 10000 });
    const offersOpen = await page.getByRole('button', { name: /Open Shift/ }).isVisible().catch(() => false);
    const hasClose = await page.getByRole('button', { name: /Close Shift/ }).isVisible().catch(() => false);
    must(!offersOpen && hasClose, `after reload: Open Shift visible=${offersOpen}, Close Shift visible=${hasClose}`);
    console.log('  after F5: billing screen resumed (Close Shift shown, no Open Shift prompt)');

    // 3. Checkout: invoice number format and cashier on the receipt.
    await addOneItem(page);
    await page.getByRole('button', { name: /^Checkout/ }).last().click();
    const addCash = page.getByRole('button', { name: /Add Cash payment/ });
    if (await addCash.isVisible().catch(() => false)) await addCash.click();
    await page.getByRole('button', { name: /Complete Sale/ }).click();
    await page.getByText('Sale Complete').first().waitFor({ timeout: 10000 });
    const sale = checkouts.at(-1);
    must(sale && sale.status >= 200 && sale.status < 300, `checkout failed: ${JSON.stringify(sale)}`);
    const invoiceNo: string = sale.body.data.order.invoice_no;
    const cashier: string = sale.body.data.print_payload.meta.cashier;
    must(INVOICE_FORMAT.test(invoiceNo) && !/null|undefined/i.test(invoiceNo), `invoice number "${invoiceNo}" is not PREFIX/YYYY-YY/COUNTER/NNNNNN`);
    if (store.expectedPrefix) must(invoiceNo.startsWith(`${store.expectedPrefix}/`), `invoice "${invoiceNo}" should start with ${store.expectedPrefix}/`);
    must(cashier === userName, `receipt cashier "${cashier}", expected "${userName}"`);
    console.log(`  checkout ${sale.status}: invoice ${invoiceNo}, cashier "${cashier}"`);
    must(pageErrors.length === 0, `page errors: ${pageErrors.join(' | ')}`);
  } finally {
    await context.close();
    await closeOpenShifts(cookie, 'edge-case test cleanup');
  }
}

async function main() {
  const browser = await chromium.launch();
  try {
    for (const store of STORES) {
      console.log(`${store.label}:`);
      await verifyStore(browser, store);
    }
  } finally {
    await browser.close();
  }
  console.log('\n✅ Cashier attribution, shift hydration on reload and invoice numbering verified.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
