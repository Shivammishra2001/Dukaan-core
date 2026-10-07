/**
 * Verifies the cross-session ERR_STORE_MISMATCH fix on POS checkout.
 *
 * Bug: logout -> login is a client-side navigation, so the in-memory cart and
 * open shift from store A survived into store B's session in the same tab;
 * B then billed with A's counter/shift/product ids and the backend rejected
 * every checkout with 403 ERR_STORE_MISMATCH. lib/session-scope.ts now resets
 * that state when the verified session's store/user changes.
 *
 * Flow (one browser tab, UI-driven):
 *   1. Store A (Harshit Enterprises) logs in, opens a shift, adds an item.
 *   2. Logs out via the sidebar, store B logs in on the same tab.
 *   3. Asserts B sees an empty POS (its own Open Shift drawer, none of A's cart).
 *   4. B opens a shift, adds its own product, toggles its unit (e.g. KG <-> G)
 *      and completes a cash sale -> 2xx, with the drawer's expected cash rising.
 *   5. API check: B's session with A's counter id is still refused (403).
 *   6. Closes the shifts this run opened.
 *
 * Store B is a dedicated test company ("Scope Test Kirana", phone 9000000001)
 * registered on first run (it comes with the KIRANA starter catalogue). Needs frontend :3000 and backend :1337 running.
 * Run: node scripts/test-session-scope.ts
 */
import { chromium, type Page } from 'playwright';

const BASE = 'http://localhost:3000';
const STORE_A = { phone: '9876543210', password: 'testpass123' };
const STORE_B = { phone: '9000000001', password: 'testpass123', company: 'Scope Test Kirana', owner: 'Scope Tester' };

function must(cond: unknown, message: string): asserts cond {
  if (!cond) throw new Error(`ASSERTION FAILED: ${message}`);
}

async function apiLogin(phone: string, password: string): Promise<string | null> {
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ identifier: phone, password }),
  });
  if (!res.ok) return null;
  const cookie = res.headers.getSetCookie().find((c) => c.startsWith('dukaan_session='));
  return cookie ? cookie.split(';')[0] : null;
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

async function closeActiveShift(cookie: string, reason: string) {
  const me = await bff(cookie, '/api/auth/me');
  const shiftId = me.json?.data?.active_shift?.id;
  if (!shiftId) return;
  const expected = await bff(cookie, `/api/shifts/${shiftId}/expected`);
  const expectedPaise = Math.max(0, Number(expected.json?.data?.expected_cash_paise ?? 0));
  const res = await bff(cookie, `/api/shifts/${shiftId}/close`, {
    method: 'POST',
    body: JSON.stringify({ denomination_count: { coins_paise: expectedPaise }, variance_reason_code: 'OTHER', variance_reason_text: reason, approval_token: 'e2e-cleanup' }),
  });
  must(res.ok, `could not close shift ${shiftId}: ${res.text}`);
}

async function ensureStoreB(): Promise<string> {
  let cookie = await apiLogin(STORE_B.phone, STORE_B.password);
  if (!cookie) {
    const res = await fetch(`${BASE}/api/auth/register-company`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ company_name: STORE_B.company, business_preset: 'KIRANA', owner_name: STORE_B.owner, phone: STORE_B.phone, password: STORE_B.password, state: 'DL', city: 'Delhi' }),
    });
    must(res.ok, `register store B failed: ${res.status} ${await res.text()}`);
    cookie = await apiLogin(STORE_B.phone, STORE_B.password);
  }
  must(cookie, 'store B login failed');
  return cookie;
}

async function uiLogin(page: Page, phone: string, password: string) {
  await page.locator('form input').first().fill(phone);
  await page.locator('form input[type="password"]').fill(password);
  await page.locator('form button[type="submit"]').click();
}

async function openShiftIfNeeded(page: Page) {
  const btn = page.getByRole('button', { name: /Open Shift/ });
  if (await btn.isVisible().catch(() => false)) {
    await btn.click();
    await page.getByPlaceholder(/Scan barcode/).waitFor({ timeout: 10000 });
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

async function main() {
  const cookieA = await apiLogin(STORE_A.phone, STORE_A.password);
  must(cookieA, 'store A login failed');
  const cookieB = await ensureStoreB();
  await closeActiveShift(cookieA, 'session-scope test pre-flight');
  await closeActiveShift(cookieB, 'session-scope test pre-flight');

  const browser = await chromium.launch();
  const page = await (await browser.newContext({ viewport: { width: 1600, height: 1000 } })).newPage();
  const checkoutResponses: Array<{ status: number; body: string }> = [];
  page.on('response', async (res) => {
    if (res.url().includes('/api/pos/checkout')) checkoutResponses.push({ status: res.status(), body: await res.text().catch(() => '') });
  });
  const pageErrors: string[] = [];
  page.on('pageerror', (err) => pageErrors.push(err.message));

  try {
    // 1. Store A: open shift, put something in the cart.
    await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' });
    await uiLogin(page, STORE_A.phone, STORE_A.password);
    await page.waitForURL(/\/(pos|dashboard)/);
    await page.goto(`${BASE}/pos`, { waitUntil: 'networkidle' });
    await openShiftIfNeeded(page);
    await addOneItem(page);
    const aCartText = await page.locator('body').innerText();
    console.log('1. Store A: shift open, item in cart');

    // 2. Log out (client-side navigation) and log in as store B in the same tab.
    await page.getByRole('button', { name: 'Logout' }).first().click();
    await page.waitForURL(/\/login/);
    await uiLogin(page, STORE_B.phone, STORE_B.password);
    await page.waitForURL(/\/pos/);
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(800);

    // 3. B must not inherit A's shift or cart.
    const bText = await page.locator('body').innerText();
    const openShiftVisible = await page.getByRole('button', { name: /Open Shift/ }).isVisible().catch(() => false);
    must(openShiftVisible, `store B should see its own Open Shift drawer, not store A's shift. Screen:\n${bText.slice(0, 600)}`);
    must(!bText.includes('Grand Total'), 'store B inherited a non-empty cart from store A');
    console.log('2. Store B after same-tab login: own Open Shift drawer, empty cart');
    void aCartText;

    // 4. B completes a real sale.
    await openShiftIfNeeded(page);
    const shiftB = (await bff(cookieB, '/api/auth/me')).json?.data?.active_shift?.id;
    must(shiftB, 'store B has no active shift after opening one');
    const expectedCash = async () => Number((await bff(cookieB, `/api/shifts/${shiftB}/expected`)).json?.data?.expected_cash_paise ?? NaN);
    const cashBefore = await expectedCash();

    await addOneItem(page);

    // Unit toggle (e.g. G <-> KG, ML <-> L): the line total must recalculate, and
    // toggling back must restore it exactly (no drift in price or base qty).
    const lineTotal = () => page.locator('td.font-semibold.text-slate-900').last().innerText();
    const unitSelect = page.locator('table select').first();
    const unitOptions = await unitSelect.locator('option').allTextContents();
    if (unitOptions.length > 1) {
      // A unit change converts the quantity so the base amount (and so the
      // price) stays the same — 1 KG == 1000 G — so assert the unit really
      // switched with no error toast and the total is preserved both ways.
      const errorToast = page.locator('.bg-rose-600');
      const original = await unitSelect.inputValue();
      const other = await unitSelect.locator(`option:not([disabled]):not([value="${original}"])`).first().getAttribute('value');
      must(other, `no convertible alternative unit offered besides ${original}`);
      const before = await lineTotal();
      await unitSelect.selectOption(other);
      await page.waitForTimeout(300);
      const toggledUnit = await unitSelect.inputValue();
      const toggleError = (await errorToast.count()) ? await errorToast.first().innerText() : null;
      const toggled = await lineTotal();
      await unitSelect.selectOption(original);
      await page.waitForTimeout(300);
      const restoredUnit = await unitSelect.inputValue();
      const restored = await lineTotal();
      console.log(`3. Unit toggle ${original} -> ${toggledUnit} -> ${restoredUnit}: totals ${before} -> ${toggled} -> ${restored}${toggleError ? `, toast: ${toggleError}` : ''}`);
      must(!toggleError, `unit change raised an error: ${toggleError}`);
      must(toggledUnit === other && restoredUnit === original, `unit select did not switch ${original} -> ${other} -> ${original}`);
      must(toggled === before, `line total changed on a pure unit conversion: ${before} -> ${toggled}`);
      must(restored === before, `line total drifted after toggling back: ${before} -> ${restored}`);
    } else {
      console.log('3. Item has a single sale unit — unit toggle not applicable');
    }

    await page.getByRole('button', { name: /^Checkout/ }).last().click();
    const addCash = page.getByRole('button', { name: /Add Cash payment/ });
    if (await addCash.isVisible().catch(() => false)) await addCash.click();
    await page.getByRole('button', { name: /Complete Sale/ }).click();
    await page.getByText('Sale Complete').first().waitFor({ timeout: 10000 });
    must(checkoutResponses.length > 0, 'no /api/pos/checkout request was made');
    // 201 Created for a new order, 200 for an idempotent replay.
    for (const r of checkoutResponses) must(r.status >= 200 && r.status < 300, `checkout returned ${r.status}: ${r.body}`);
    must(!checkoutResponses.some((r) => r.body.includes('ERR_STORE_MISMATCH')), 'ERR_STORE_MISMATCH in a checkout response');
    const cashAfter = await expectedCash();
    must(cashAfter > cashBefore, `expected cash did not increase: ${cashBefore} -> ${cashAfter}`);
    console.log(`4. Store B checkout: HTTP ${checkoutResponses.map((r) => r.status).join(', ')}; expected cash ${cashBefore} -> ${cashAfter} paise`);
  } finally {
    await browser.close();
  }

  // 5. Backend still refuses another store's counter under B's session.
  const counterA = (await bff(cookieA, '/api/pos/counters')).json?.data?.[0]?.documentId;
  must(counterA, 'could not read store A counter');
  const productB = (await bff(cookieB, '/api/inventory/products')).json?.data?.[0];
  must(productB, 'store B has no products');
  const uuid = crypto.randomUUID();
  const forged = await bff(cookieB, '/api/pos/checkout', {
    method: 'POST',
    headers: { 'Idempotency-Key': uuid },
    body: JSON.stringify({
      client_uuid: uuid,
      counter_id: counterA,
      order_type: 'SALE',
      items: [{ line_group_id: crypto.randomUUID(), product_id: productB.documentId, entered_qty: '1', entered_unit: 'PCS', price_source: 'PRODUCT' }],
      payments: [{ method: 'CASH', amount_paise: 1000, tendered_paise: 1000 }],
      client_totals: {},
      client_created_at: new Date().toISOString(),
      is_offline_origin: false,
    }),
  });
  must(forged.status === 403 && forged.json?.error?.code === 'ERR_STORE_MISMATCH', `store B + store A counter should be 403 ERR_STORE_MISMATCH, got ${forged.status} ${forged.text}`);
  console.log(`5. Store B session + store A counter: ${forged.status} ${forged.json.error.code} (still enforced)`);

  // 6. Clean up the shifts this run opened.
  await closeActiveShift(cookieA, 'session-scope test cleanup');
  await closeActiveShift(cookieB, 'session-scope test cleanup');
  must(pageErrors.length === 0, `page errors: ${pageErrors.join(' | ')}`);
  console.log('\n✅ No cross-store state leak; store B checkout succeeds; backend store guard intact.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
