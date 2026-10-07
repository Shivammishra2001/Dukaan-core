/**
 * Runtime Hindi localization check. Logs in, switches the UI to `hi`, opens
 * the main screens (plus a few modals) in headless Chromium and fails if:
 *   1. any visible text / placeholder / aria-label / title exactly equals an
 *      English dictionary value that has a different Hindi translation
 *      (i.e. a string that bypassed t() or fell back to `en`);
 *   2. a raw translation key (e.g. `pos.cartEmpty`, `enum.payment.CASH`) or
 *      a `[missing: ...]` marker is visible;
 *   3. React logs a hydration error or the page throws.
 * Remaining Latin-script text is printed for review (product/customer names
 * from the database, trade acronyms like GST/SKU) but does not fail the run.
 *
 * Needs the Next server on :3000 (npm run build && npm run start) and the
 * Strapi backend on :1337.
 *
 * Usage: node scripts/verify-hindi.js
 * Env:   BASE_URL (default http://localhost:3000),
 *        I18N_LOGIN_ID / I18N_LOGIN_PASSWORD (default: the seeded e2e test owner)
 */
const fs = require('fs');
const path = require('path');
const ts = require('typescript');
const { chromium } = require('playwright');

const BASE = process.env.BASE_URL || 'http://localhost:3000';
const LOGIN_ID = process.env.I18N_LOGIN_ID || '9876543210';
const LOGIN_PASSWORD = process.env.I18N_LOGIN_PASSWORD || 'testpass123';

// Trade acronyms / brand names that are normal in Hindi-language shop software.
const LATIN_ALLOW = new Set(['GST', 'CGST', 'SGST', 'IGST', 'SKU', 'MRP', 'UPI', 'PIN', 'GRN', 'UTR', 'NEFT', 'GSTIN', 'PDF', 'A4', 'WhatsApp', 'DUKAAN', 'Core', 'EN', 'Hg', 'Hinglish', 'English', 'F1', 'F2', 'F3', 'F4', 'F6', 'F8', 'F9', 'Esc', 'QR', 'HSN', 'Z']);

function loadDictionary() {
  const src = fs.readFileSync(path.join(__dirname, '..', 'lib', 'translations', 'index.ts'), 'utf8');
  const sf = ts.createSourceFile('t.ts', src, ts.ScriptTarget.Latest, true);
  const langs = {};
  (function visit(n) {
    if (ts.isVariableDeclaration(n) && n.name.getText() === 'TRANSLATIONS') {
      for (const p of n.initializer.properties) {
        langs[p.name.text] = Object.fromEntries(p.initializer.properties.map((q) => [q.name.text, q.initializer.text]));
      }
    }
    ts.forEachChild(n, visit);
  })(sf);
  return langs;
}

async function login() {
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ identifier: LOGIN_ID, password: LOGIN_PASSWORD }),
  });
  if (!res.ok) throw new Error(`login failed (${res.status}): ${await res.text()}`);
  const cookie = (res.headers.getSetCookie?.() ?? [res.headers.get('set-cookie')]).find((c) => c && c.startsWith('dukaan_session='));
  if (!cookie) throw new Error('login succeeded but no dukaan_session cookie was set');
  return cookie.split(';')[0].split('=').slice(1).join('=');
}

async function firstId(cookie, apiPath, field = 'id') {
  const res = await fetch(`${BASE}${apiPath}`, { headers: { cookie: `dukaan_session=${cookie}` } });
  if (!res.ok) return null;
  const body = await res.json();
  const list = Array.isArray(body) ? body : body.data ?? body.items ?? [];
  return list[0]?.[field] ?? null;
}

/** Collects every visible text node plus user-facing attributes on the page. */
function collectVisibleStrings() {
  const out = [];
  const visible = (el) => {
    if (!el) return false;
    const s = getComputedStyle(el);
    if (s.display === 'none' || s.visibility === 'hidden') return false;
    if (el.tagName === 'OPTION') return visible(el.closest('select'));
    return el.getClientRects().length > 0;
  };
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const text = n.textContent.replace(/\s+/g, ' ').trim();
    const el = n.parentElement;
    if (!text || !el || ['SCRIPT', 'STYLE', 'NOSCRIPT'].includes(el.tagName)) continue;
    if (visible(el)) out.push({ kind: 'text', text });
  }
  for (const el of document.querySelectorAll('[placeholder],[aria-label],[title]')) {
    if (!visible(el)) continue;
    for (const attr of ['placeholder', 'aria-label', 'title']) {
      const v = el.getAttribute(attr);
      if (v && v.trim()) out.push({ kind: attr, text: v.trim() });
    }
  }
  return out;
}

async function main() {
  const dict = loadDictionary();
  const en = dict.en;
  const hi = dict.hi;
  const englishOnly = new Map(); // English value -> key, for values whose Hindi differs
  for (const [k, v] of Object.entries(en)) if (hi[k] && hi[k] !== v && /[A-Za-z]{3,}/.test(v)) englishOnly.set(v.trim(), k);
  const keyPattern = new RegExp(`^(${[...new Set(Object.keys(en).map((k) => k.split('.')[0]))].join('|')})\\.[A-Za-z0-9_.]+$`);

  const cookie = await login();
  // Ledger actions resolve by documentId (the directory pages' numeric-id links currently 404).
  const customerId = await firstId(cookie, '/api/customers', 'documentId');
  const supplierId = await firstId(cookie, '/api/b2b/suppliers', 'documentId');

  const browser = await chromium.launch();
  const failures = [];
  const review = new Map();

  async function sweep(label, url, { viewport, loggedIn = true, actions = [] } = {}) {
    const context = await browser.newContext({ viewport: viewport ?? { width: 1440, height: 900 } });
    if (loggedIn) await context.addCookies([{ name: 'dukaan_session', value: cookie, url: BASE }]);
    await context.addInitScript(() => window.localStorage.setItem('dukaan_language', 'hi'));
    const page = await context.newPage();
    const pageErrors = [];
    page.on('console', (msg) => {
      const text = msg.text();
      if (msg.type() === 'error' && /hydrat|did not match|Minified React error #(418|423|425)/i.test(text)) pageErrors.push(`hydration: ${text.slice(0, 200)}`);
    });
    page.on('pageerror', (err) => pageErrors.push(`pageerror: ${err.message.slice(0, 200)}`));

    await page.goto(`${BASE}${url}`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(600);
    const lang = await page.evaluate(() => document.documentElement.lang);
    if (lang !== 'hi') failures.push(`${label}: <html lang> is "${lang}", expected "hi"`);

    const snapshots = [{ step: 'page', strings: await page.evaluate(collectVisibleStrings) }];
    for (const action of actions) {
      const target = page.getByRole('button', { name: action.hiText, exact: false }).first();
      if (!(await target.count()) || !(await target.isVisible())) {
        console.log(`  · ${label}: skipped "${action.name}" (button not on screen)`);
        continue;
      }
      await target.click();
      await page.waitForTimeout(500);
      snapshots.push({ step: action.name, strings: await page.evaluate(collectVisibleStrings) });
      await page.keyboard.press('Escape');
      if (action.closeWith) {
        const close = page.getByRole('button', { name: action.closeWith, exact: true }).first();
        if (await close.count()) await close.click().catch(() => {});
      }
      await page.waitForTimeout(200);
    }

    let checked = 0;
    for (const { step, strings } of snapshots) {
      for (const { kind, text } of strings) {
        checked++;
        const where = `${label}${step === 'page' ? '' : ` › ${step}`} [${kind}]`;
        if (englishOnly.has(text)) failures.push(`${where}: English UI string "${text}" (key ${englishOnly.get(text)})`);
        if (keyPattern.test(text)) failures.push(`${where}: raw translation key "${text}"`);
        if (/\[missing:/i.test(text)) failures.push(`${where}: missing-translation marker "${text}"`);
        const latin = (text.match(/[A-Za-z][A-Za-z']+/g) || []).filter((w) => !LATIN_ALLOW.has(w));
        if (latin.length) review.set(text, where);
      }
    }
    for (const e of pageErrors) failures.push(`${label}: ${e}`);
    console.log(`✓ ${label.padEnd(26)} ${checked} strings checked${pageErrors.length ? `, ${pageErrors.length} errors` : ''}`);
    await context.close();
  }

  const H = (key) => hi[key];
  await sweep('/login', '/login', { loggedIn: false, actions: [{ name: 'cashier tab', hiText: H('auth.cashierPin') }] });
  await sweep('/register', '/register', { loggedIn: false });
  await sweep('/dashboard', '/dashboard');
  await sweep('/dashboard (mobile)', '/dashboard', { viewport: { width: 390, height: 844 }, actions: [{ name: 'menu drawer', hiText: H('nav.openMenu') }] });
  await sweep('/settings', '/settings');
  await sweep('/b2b/purchases', '/b2b/purchases', { actions: [{ name: 'add line', hiText: H('b2b.addFirstItem') }] });
  await sweep('/b2b/orders', '/b2b/orders');
  await sweep('/b2b/dispatch', '/b2b/dispatch');
  await sweep('/b2b/suppliers', '/b2b/suppliers');
  if (supplierId) await sweep('/b2b/suppliers/[id]/ledger', `/b2b/suppliers/${supplierId}/ledger`, { actions: [{ name: 'settle payment modal', hiText: H('suppliers.settlePayment'), closeWith: H('common.cancel') }] });
  await sweep('/customers/ledger', '/customers/ledger');
  if (customerId) await sweep('/customers/[id]/ledger', `/customers/${customerId}/ledger`, { actions: [{ name: 'record payment modal', hiText: H('khata.recordPayment'), closeWith: H('common.cancel') }] });
  await sweep('/inventory', '/inventory', {
    actions: [
      { name: 'add product modal', hiText: H('inventory.addProductService'), closeWith: H('common.cancel') },
      { name: 'bulk import modal', hiText: H('import.uploadButton'), closeWith: H('common.cancel') },
    ],
  });
  await sweep('/reports/shifts', '/reports/shifts');
  await sweep('/pos', '/pos', {
    actions: [
      { name: 'cash in/out modal', hiText: H('pos.cashInOut') },
      { name: 'close shift modal', hiText: H('pos.closeShift') },
      { name: 'khula hisaab', hiText: H('pos.khulaHisaab') },
    ],
  });

  await browser.close();

  if (review.size) {
    console.log(`\nLatin-script text left for manual review (${review.size}) — expected to be data (names, SKUs) or trade acronyms:`);
    for (const [text, where] of review) console.log(`  ${where}: ${JSON.stringify(text.slice(0, 90))}`);
  }
  if (failures.length) {
    console.log(`\n✗ ${failures.length} localization failure(s):`);
    for (const f of failures) console.log(`  ${f}`);
    process.exit(1);
  }
  console.log('\n✓ No English UI strings, raw keys, missing markers or hydration errors in Hindi mode.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
