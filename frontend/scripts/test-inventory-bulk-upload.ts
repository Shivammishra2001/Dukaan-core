/**
 * Verifies the Saman & Rates bulk import (POST /api/inventory/bulk-upload)
 * under the Harshit Enterprises session:
 *   0. The template downloads as a real .xlsx with the expected headers.
 *   1. A generated .xlsx with 2 new products, 1 existing product (new rates +
 *      a counted stock, matched by *name* in a different case — the fallback
 *      key) and 2 invalid rows -> 2 created, 1 updated, 2 failed:
 *        - "8%" GST;
 *        - a product priced per PACKET given in KG, which must be refused
 *          rather than silently repriced per KG.
 *   2. The existing product's rates changed and its stock equals the count;
 *      the new products are in the catalogue with the right units/stock.
 *   3. Uploading the same file again creates nothing (upsert, no duplicates).
 *   4. The same via the UI: a .csv through the Upload Products Excel modal
 *      shows the summary and offers the failed-rows download.
 *   5. No ERR_STORE_MISMATCH anywhere.
 *
 * The two new products get a per-run barcode (BULKTEST-<run>-A/B), so each
 * run adds two clearly labelled test products to the store's catalogue.
 * Needs frontend :3000 and backend :1337 running.
 * Run: node scripts/test-inventory-bulk-upload.ts
 */
import ExcelJS from 'exceljs';
import { chromium } from 'playwright';

const BASE = 'http://localhost:3000';
const LOGIN = { identifier: '9876543210', password: 'testpass123' };

function must(cond: unknown, message: string): asserts cond {
  if (!cond) throw new Error(`ASSERTION FAILED: ${message}`);
}

async function login(): Promise<string> {
  const res = await fetch(`${BASE}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(LOGIN) });
  must(res.ok, `login failed: ${res.status}`);
  const cookie = res.headers.getSetCookie().find((c) => c.startsWith('dukaan_session='));
  must(cookie, 'no session cookie');
  return cookie.split(';')[0];
}

async function catalogue(cookie: string): Promise<any[]> {
  const res = await fetch(`${BASE}/api/inventory/products`, { headers: { Cookie: cookie } });
  must(res.ok, `GET /api/inventory/products -> ${res.status}`);
  return (await res.json()).data;
}

function stockOf(p: any): number {
  return (p.batches ?? []).filter((b: any) => b.status === 'ACTIVE').reduce((s: number, b: any) => s + Number(b.current_stock_base), 0);
}

async function upload(cookie: string, file: Buffer, name: string) {
  const form = new FormData();
  form.append('file', new Blob([new Uint8Array(file)], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), name);
  const res = await fetch(`${BASE}/api/inventory/bulk-upload`, { method: 'POST', headers: { Cookie: cookie }, body: form });
  const text = await res.text();
  must(!text.includes('ERR_STORE_MISMATCH'), `ERR_STORE_MISMATCH in upload response: ${text}`);
  must(res.ok, `bulk-upload -> ${res.status}: ${text}`);
  return JSON.parse(text).data;
}

async function main() {
  const cookie = await login();

  // 0. Template.
  const tpl = await fetch(`${BASE}/api/inventory/template?format=xlsx`, { headers: { Cookie: cookie } });
  must(tpl.ok && (tpl.headers.get('content-type') ?? '').includes('spreadsheetml'), `template download -> ${tpl.status} ${tpl.headers.get('content-type')}`);
  const tplBook = new ExcelJS.Workbook();
  await tplBook.xlsx.load(await tpl.arrayBuffer());
  const headers = (tplBook.getWorksheet('Products')!.getRow(1).values as unknown[]).slice(1);
  must(headers.join(',') === 'product_name,sku,category,base_unit,mrp,retail_rate,wholesale_tier1_rate,wholesale_tier2_rate,gst_slab,current_stock,hsn_code', `template headers: ${headers.join(',')}`);
  console.log(`0. Template: ${headers.length} columns, ${tplBook.getWorksheet('Products')!.rowCount - 1} sample rows, sheets: ${tplBook.worksheets.map((w) => w.name).join(' + ')}`);

  // An existing per-piece product with a real rate; the file sets MRP ₹20 above its rate and nudges the rate up.
  const before = await catalogue(cookie);
  const existing = before.find((p) => p.base_unit === 'PCS' && p.pricing_unit === 'PCS' && Number(p.sell_rate_paise) >= 1000 && !String(p.sku).startsWith('BULKTEST-'));
  must(existing, 'no existing per-piece product to update');
  const packed = before.find((p) => p.base_unit === 'G' && p.pricing_unit === 'PACKET');
  must(packed, 'no existing PACKET-priced product for the pricing-unit guard');
  const oldRetail = Number(existing.sell_rate_paise) / 100;
  const mrp = Number((oldRetail + 20).toFixed(2));
  const newRetail = Number((oldRetail + (Number(existing.mrp_paise) / 100 === mrp ? 2 : 1)).toFixed(2));
  const newTier1 = Number((newRetail - 3).toFixed(2));
  const newTier2 = Number((newRetail - 5).toFixed(2));
  const countedStock = Math.max(0, Math.round(stockOf(existing))) + 7;

  const run = Date.now().toString(36).toUpperCase();
  const skuA = `BULKTEST-${run}-A`;
  const skuB = `BULKTEST-${run}-B`;

  // 1. Build the upload the way a user would fill the template.
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Products');
  ws.addRow(['product_name', 'sku', 'category', 'base_unit', 'mrp', 'retail_rate', 'wholesale_tier1_rate', 'wholesale_tier2_rate', 'gst_slab', 'current_stock', 'hsn_code']);
  ws.addRow([`Bulk Test Sunflower Oil 1L ${run}`, skuA, 'Grocery', 'PCS', 180, 165, 160, 155, 5, 12, '1512']);
  ws.addRow([`Bulk Test Loose Chana ${run}`, skuB, 'Grocery', 'KG', 120, 110, 105, 100, '0%', 25.5, '0713']);
  const gst = [0, 5, 12, 18, 28].includes(Number(existing.gst_rate)) ? Number(existing.gst_rate) : '';
  ws.addRow([existing.name.toUpperCase(), '', '', 'PCS', mrp, newRetail, newTier1, newTier2, gst, countedStock, '']);
  ws.addRow([`Bulk Test Bad GST ${run}`, '', 'Grocery', 'PCS', 50, 45, '', '', '8%', '', '']);
  ws.addRow([packed.name, packed.sku, '', 'KG', '', 30, '', '', '', '', '']);
  const file = Buffer.from(await wb.xlsx.writeBuffer());

  const first = await upload(cookie, file, 'bulk-test.xlsx');
  console.log(`1. First upload: total ${first.total_rows}, created ${first.created}, updated ${first.updated}, failed ${first.failed}`);
  must(first.total_rows === 5 && first.created === 2 && first.updated === 1 && first.failed === 2, `unexpected summary ${JSON.stringify(first)}`);
  const bad = first.rows.find((r: any) => r.row_number === 5);
  must(bad.status === 'FAILED' && bad.errors[0].code === 'GST_INVALID' && bad.errors[0].params.value === '8%', `bad row: ${JSON.stringify(bad)}`);
  const unitGuard = first.rows.find((r: any) => r.row_number === 6);
  must(unitGuard.status === 'FAILED' && unitGuard.errors[0].code === 'PRICING_UNIT_CHANGE', `pricing-unit guard: ${JSON.stringify(unitGuard)}`);
  const packedAfter = (await catalogue(cookie)).find((p) => p.documentId === packed.documentId);
  must(packedAfter.sell_rate_paise === packed.sell_rate_paise && packedAfter.pricing_unit === 'PACKET', 'PACKET product was changed');
  console.log(`   Row ${bad.row_number} rejected: ${bad.errors[0].message}`);
  console.log(`   Row ${unitGuard.row_number} rejected: ${unitGuard.errors[0].message} (rate left at ₹${Number(packed.sell_rate_paise) / 100}/PACKET)`);

  // 2. Catalogue state.
  const after = await catalogue(cookie);
  const updated = after.find((p) => p.documentId === existing.documentId);
  must(updated, 'existing product vanished');
  must(Number(updated.sell_rate_paise) === Math.round(newRetail * 100), `retail rate ${updated.sell_rate_paise}, expected ${Math.round(newRetail * 100)}`);
  must(Number(updated.wholesale_tier1_rate_paise) === Math.round(newTier1 * 100), `tier-1 ${updated.wholesale_tier1_rate_paise}`);
  must(Number(updated.wholesale_tier2_rate_paise) === Math.round(newTier2 * 100), `tier-2 ${updated.wholesale_tier2_rate_paise}`);
  must(stockOf(updated) === countedStock, `stock ${stockOf(updated)}, expected counted ${countedStock}`);
  must(Number(updated.mrp_paise) === Math.round(mrp * 100), `MRP ${updated.mrp_paise}`);
  must(updated.name === existing.name, `name-matched update renamed "${existing.name}" to "${updated.name}"`);
  console.log(`2. Updated "${existing.name}" (matched by name): retail ₹${oldRetail} -> ₹${newRetail}, MRP ₹${mrp}, tier-1 ₹${newTier1}, tier-2 ₹${newTier2}, stock ${stockOf(existing)} -> ${stockOf(updated)}`);

  const a = after.filter((p) => p.sku === skuA);
  const b = after.filter((p) => p.sku === skuB);
  must(a.length === 1 && b.length === 1, `new products: ${a.length} x ${skuA}, ${b.length} x ${skuB}`);
  must(a[0].base_unit === 'PCS' && stockOf(a[0]) === 12 && Number(a[0].gst_rate) === 5, `product A: ${a[0].base_unit} stock ${stockOf(a[0])} gst ${a[0].gst_rate}`);
  const kgConv = (b[0].unit_conversions ?? []).find((c: any) => c.unit_code === 'KG');
  must(b[0].base_unit === 'G' && b[0].pricing_unit === 'KG' && Number(kgConv?.factor_to_base) === 1000 && stockOf(b[0]) === 25500, `product B: base ${b[0].base_unit}, pricing ${b[0].pricing_unit}, KG factor ${kgConv?.factor_to_base}, stock ${stockOf(b[0])}`);
  must(after.length === before.length + 2, `catalogue grew by ${after.length - before.length}, expected 2`);
  console.log(`   New: ${skuA} (PCS, stock 12, GST 5%) and ${skuB} (KG -> base G, KG factor 1000, stock 25.5 kg = 25500 g)`);

  // 3. Same file again: everything matches now.
  const second = await upload(cookie, file, 'bulk-test.xlsx');
  const again = await catalogue(cookie);
  console.log(`3. Re-upload: created ${second.created}, updated ${second.updated}, failed ${second.failed}; catalogue size ${again.length} (was ${after.length})`);
  must(second.created === 0 && second.updated === 3 && second.failed === 2 && again.length === after.length, 'second upload created duplicates');
  must(again.filter((p) => p.sku === skuA).length === 1 && again.filter((p) => p.sku === skuB).length === 1, 'duplicate SKUs after re-upload');
  must(stockOf(again.find((p) => p.documentId === existing.documentId)) === countedStock, 'counted stock drifted on re-upload');

  // 4. UI: CSV through the modal (updates product A's rate, one bad row).
  const csv = [
    '# comment lines are ignored',
    'Product Name,Barcode,Unit,Retail Rate,MRP,GST %',
    `"Bulk Test Sunflower Oil 1L ${run}",${skuA},PCS,162,180,5`,
    `Bulk Test Bad Unit ${run},,BOX,10,,`,
  ].join('\r\n');
  const browser = await chromium.launch();
  try {
    const context = await browser.newContext({ viewport: { width: 1400, height: 900 }, acceptDownloads: true });
    await context.addCookies([{ name: 'dukaan_session', value: cookie.split('=')[1], url: BASE }]);
    const page = await context.newPage();
    const pageErrors: string[] = [];
    page.on('pageerror', (e) => pageErrors.push(e.message));
    await page.goto(`${BASE}/inventory`, { waitUntil: 'networkidle' });
    await page.getByRole('button', { name: 'Upload Products Excel' }).click();
    await page.locator('input[type="file"]').setInputFiles({ name: 'rates.csv', mimeType: 'text/csv', buffer: Buffer.from(csv, 'utf8') });
    await page.getByRole('button', { name: 'Start Import' }).click();
    await page.getByText('Import finished — some rows need fixing').waitFor({ timeout: 20000 });
    const dialog = await page.locator('div.fixed').last().innerText();
    must(/Existing products updated\s*1/.test(dialog) && /Failed rows\s*1/.test(dialog), `summary dialog:\n${dialog}`);
    must(dialog.includes("Invalid unit 'BOX'"), `failed-row reason missing:\n${dialog}`);
    const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Download failed rows' }).click()]);
    const chunks: Buffer[] = [];
    for await (const chunk of await download.createReadStream()) chunks.push(chunk as Buffer);
    const failedCsv = Buffer.concat(chunks).toString('utf8');
    must(failedCsv.includes(`Bulk Test Bad Unit ${run}`) && failedCsv.includes('BOX'), `failed-rows CSV:\n${failedCsv}`);
    must(pageErrors.length === 0, `page errors: ${pageErrors.join(' | ')}`);
    const viaUi = (await catalogue(cookie)).find((p) => p.sku === skuA);
    must(Number(viaUi.sell_rate_paise) === 16200, `UI import did not update ${skuA}: ${viaUi.sell_rate_paise}`);
    console.log(`4. UI (CSV): summary shows 1 updated / 1 failed with reason; failed-rows CSV has ${failedCsv.trim().split('\n').length - 1} row; ${skuA} retail -> ₹162`);
  } finally {
    await browser.close();
  }

  console.log('\n✅ Bulk import: 2 created, 1 updated, bad row reported, re-upload idempotent, no ERR_STORE_MISMATCH.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
