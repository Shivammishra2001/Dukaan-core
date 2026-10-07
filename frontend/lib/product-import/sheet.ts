import ExcelJS from 'exceljs';
import type { RawImportRow } from '@/types/product-import';

/**
 * Server-only (BFF) spreadsheet handling for the Saman & Rates bulk import:
 * builds the downloadable template and turns an uploaded .xlsx/.csv into
 * raw rows. Validation and writes are the backend's job
 * (backend/src/api/product-import) — this layer only maps columns and
 * normalizes cells to strings.
 *
 * `exceljs` rather than SheetJS: the `xlsx` package on npm is frozen at
 * 0.18.5 with unpatched prototype-pollution/ReDoS advisories.
 */

export type ImportColumn = keyof Omit<RawImportRow, 'row_number'>;

export const IMPORT_COLUMNS: Array<{ key: ImportColumn; width: number; required?: boolean; note: string }> = [
  { key: 'product_name', width: 34, required: true, note: 'Required. e.g. Fortune Mustard Oil 1L. Matches an existing product by name (case-insensitive) when no barcode matches.' },
  { key: 'sku', width: 18, note: 'Barcode or SKU, e.g. 8901234567890. Used first to find an existing product. Leave blank to auto-generate for new items.' },
  { key: 'category', width: 16, note: 'e.g. Grocery, Masala, Personal Care. New categories are created automatically.' },
  { key: 'base_unit', width: 11, required: true, note: 'Required. Allowed units: PCS, POUCH, KG, G, L, ML. Rates and stock are per this unit (KG items are stocked in grams, L items in ml).' },
  { key: 'mrp', width: 10, note: 'MRP in ₹ (optional). Retail and wholesale rates cannot be above MRP.' },
  { key: 'retail_rate', width: 12, required: true, note: 'Required. POS counter rate in ₹ per base_unit.' },
  { key: 'wholesale_tier1_rate', width: 14, note: 'Bulk rate in ₹ for 5–20 units (optional).' },
  { key: 'wholesale_tier2_rate', width: 14, note: 'Heavy-bulk rate in ₹ for more than 20 units (optional).' },
  { key: 'gst_slab', width: 10, note: 'GST rates must be 0, 5, 12, 18, or 28. Blank = 0 for new items, unchanged for existing ones.' },
  { key: 'current_stock', width: 13, note: 'Counted stock in base_unit (optional). Existing items get a stock adjustment to this quantity; blank leaves stock unchanged.' },
  { key: 'hsn_code', width: 10, note: 'HSN code, 2–8 digits, e.g. 1514 (optional).' },
];

const SAMPLE_ROWS: Array<Record<ImportColumn, string | number>> = [
  { product_name: 'Fortune Mustard Oil 1L', sku: 'SAMPLE-001', category: 'Grocery', base_unit: 'PCS', mrp: 199, retail_rate: 185, wholesale_tier1_rate: 178, wholesale_tier2_rate: 172, gst_slab: 5, current_stock: 24, hsn_code: '1514' },
  { product_name: 'Loose Toor Dal', sku: 'SAMPLE-002', category: 'Grocery', base_unit: 'KG', mrp: 160, retail_rate: 150, wholesale_tier1_rate: 142, wholesale_tier2_rate: 138, gst_slab: 0, current_stock: 50, hsn_code: '0713' },
];

/** Template sample rows are skipped on upload so an unedited template imports nothing. */
export const SAMPLE_SKU_PREFIX = 'SAMPLE-';

const INSTRUCTIONS = [
  'How to use this template',
  '1. Fill one product per row on the "Products" sheet. Keep the header row as it is.',
  '2. Delete or overwrite the two SAMPLE rows — rows whose barcode starts with "SAMPLE-" are ignored on upload.',
  '3. Required columns: product_name, base_unit, retail_rate.',
  '4. Allowed units: PCS, POUCH, KG, G, L, ML (POUCH is sold per piece). Rates and stock are per that unit.',
  '5. GST rates must be 0, 5, 12, 18, or 28.',
  '6. Rates are in ₹ with up to 2 decimals. Retail and wholesale rates cannot be above MRP.',
  '7. Existing products are matched by barcode/sku first, then by exact product name, and updated — no duplicates are created.',
  '8. current_stock is the counted quantity on hand. For existing products the difference is posted as a stock adjustment.',
  '9. Keep the barcode column formatted as Text so leading zeros are not lost.',
  'Upload the file from Saman & Rates → "Upload Products Excel". Up to 2000 rows per file.',
];

export async function buildTemplateXlsx(): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'DUKAAN Core';
  const ws = wb.addWorksheet('Products', { views: [{ state: 'frozen', ySplit: 1 }] });
  ws.columns = IMPORT_COLUMNS.map((c) => ({ header: c.key, key: c.key, width: c.width }));
  ws.getColumn('sku').numFmt = '@';
  ws.getColumn('hsn_code').numFmt = '@';

  const header = ws.getRow(1);
  header.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  IMPORT_COLUMNS.forEach((c, i) => {
    const cell = header.getCell(i + 1);
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: c.required ? 'FF1D4ED8' : 'FF475569' } };
    cell.note = c.note;
  });
  for (const sample of SAMPLE_ROWS) ws.addRow(sample).font = { italic: true, color: { argb: 'FF64748B' } };

  // In-cell dropdowns for the two enumerated columns, as range rules (per-cell
  // rules would materialise 2000 empty rows in the sheet).
  const colLetter = (key: ImportColumn) => String.fromCharCode(65 + IMPORT_COLUMNS.findIndex((c) => c.key === key));
  // exceljs supports worksheet.dataValidations.add(range, rule) but doesn't declare it in its typings.
  const validations = (ws as unknown as { dataValidations: { add(range: string, rule: ExcelJS.DataValidation): void } }).dataValidations;
  validations.add(`${colLetter('base_unit')}2:${colLetter('base_unit')}2001`, {
    type: 'list',
    allowBlank: false,
    formulae: ['"PCS,POUCH,KG,G,L,ML"'],
    showErrorMessage: true,
    errorTitle: 'Invalid unit',
    error: 'Allowed units: PCS, POUCH, KG, G, L, ML',
  });
  validations.add(`${colLetter('gst_slab')}2:${colLetter('gst_slab')}2001`, {
    type: 'list',
    allowBlank: true,
    formulae: ['"0,5,12,18,28"'],
    showErrorMessage: true,
    errorTitle: 'Invalid GST rate',
    error: 'GST rates must be 0, 5, 12, 18, or 28',
  });

  const help = wb.addWorksheet('Instructions');
  help.getColumn(1).width = 110;
  INSTRUCTIONS.forEach((line, i) => {
    const row = help.addRow([line]);
    if (i === 0) row.font = { bold: true, size: 13 };
  });
  help.addRow([]);
  help.addRow(['Column', 'Meaning']).font = { bold: true };
  help.getColumn(2).width = 100;
  help.getColumn(1).width = 24;
  for (const c of IMPORT_COLUMNS) help.addRow([c.key + (c.required ? ' *' : ''), c.note]);

  return Buffer.from(await wb.xlsx.writeBuffer());
}

function csvCell(v: unknown): string {
  const s = v == null ? '' : String(v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** CSV variant: `#` comment lines carry the notes (skipped by the parser), then the header and samples. */
export function buildTemplateCsv(): string {
  const lines = [
    '# DUKAAN Core product import template. Lines starting with # are ignored.',
    '# Required: product_name, base_unit, retail_rate. Allowed units: PCS, POUCH, KG, G, L, ML.',
    '# GST rates must be 0, 5, 12, 18, or 28. Rows whose barcode starts with SAMPLE- are ignored.',
    IMPORT_COLUMNS.map((c) => c.key).join(','),
    ...SAMPLE_ROWS.map((r) => IMPORT_COLUMNS.map((c) => csvCell(r[c.key])).join(',')),
  ];
  return '﻿' + lines.join('\r\n') + '\r\n';
}

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

const HEADER_ALIASES: Record<string, ImportColumn> = {
  productname: 'product_name', name: 'product_name', product: 'product_name', itemname: 'product_name', item: 'product_name',
  sku: 'sku', barcode: 'sku', barcodesku: 'sku', skubarcode: 'sku', ean: 'sku', code: 'sku', itemcode: 'sku',
  category: 'category', group: 'category',
  baseunit: 'base_unit', unit: 'base_unit', uom: 'base_unit',
  mrp: 'mrp', mrprs: 'mrp',
  retailrate: 'retail_rate', retail: 'retail_rate', rate: 'retail_rate', sellrate: 'retail_rate', sellingrate: 'retail_rate', saleprice: 'retail_rate', price: 'retail_rate',
  wholesaletier1rate: 'wholesale_tier1_rate', tier1: 'wholesale_tier1_rate', tier1rate: 'wholesale_tier1_rate',
  wholesaletier2rate: 'wholesale_tier2_rate', tier2: 'wholesale_tier2_rate', tier2rate: 'wholesale_tier2_rate',
  gstslab: 'gst_slab', gst: 'gst_slab', gstrate: 'gst_slab', gstpercent: 'gst_slab', tax: 'gst_slab',
  currentstock: 'current_stock', stock: 'current_stock', openingstock: 'current_stock', qty: 'current_stock', quantity: 'current_stock',
  hsncode: 'hsn_code', hsn: 'hsn_code',
};

function headerKey(raw: string): ImportColumn | undefined {
  const k = raw.toLowerCase().replace(/₹|%/g, (m) => (m === '%' ? 'percent' : '')).replace(/[^a-z0-9]/g, '');
  return HEADER_ALIASES[k];
}

export class ImportFileError extends Error {
  constructor(
    public code: string,
    message: string,
    public details?: Record<string, unknown>
  ) {
    super(message);
  }
}

export interface ParsedUpload {
  rows: RawImportRow[];
  skipped_sample_rows: number;
}

function cellText(value: ExcelJS.CellValue): string {
  if (value == null) return '';
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === 'object') {
    const v = value as unknown as Record<string, unknown>;
    if ('result' in v) return cellText(v.result as ExcelJS.CellValue);
    if ('text' in v) return String(v.text ?? '');
    if (Array.isArray(v.richText)) return (v.richText as Array<{ text: string }>).map((t) => t.text).join('');
    if ('error' in v) return '';
    return '';
  }
  return String(value).trim();
}

function toRows(table: Array<{ line: number; cells: string[] }>): ParsedUpload {
  const headerIdx = table.findIndex((r) => r.cells.some((c) => c.trim() !== ''));
  if (headerIdx < 0) throw new ImportFileError('ERR_IMPORT_EMPTY', 'The file is empty');
  const mapping = table[headerIdx].cells.map((h) => headerKey(h));
  const missing = IMPORT_COLUMNS.filter((c) => c.required && !mapping.includes(c.key)).map((c) => c.key);
  if (missing.length) {
    throw new ImportFileError('ERR_IMPORT_MISSING_COLUMNS', `Missing required column(s): ${missing.join(', ')}`, { columns: missing });
  }

  const rows: RawImportRow[] = [];
  let skipped = 0;
  for (const { line, cells } of table.slice(headerIdx + 1)) {
    if (cells.every((c) => c.trim() === '')) continue;
    const row: RawImportRow = { row_number: line };
    mapping.forEach((key, i) => {
      if (key && row[key] === undefined) row[key] = (cells[i] ?? '').trim();
    });
    if (row.sku?.toUpperCase().startsWith(SAMPLE_SKU_PREFIX)) {
      skipped++;
      continue;
    }
    rows.push(row);
  }
  if (rows.length === 0) throw new ImportFileError('ERR_IMPORT_EMPTY', 'The file has no product rows (sample rows are ignored)');
  return { rows, skipped_sample_rows: skipped };
}

async function parseXlsx(buffer: Buffer): Promise<ParsedUpload> {
  const wb = new ExcelJS.Workbook();
  try {
    await wb.xlsx.load(buffer as unknown as ArrayBuffer);
  } catch {
    throw new ImportFileError('ERR_IMPORT_UNREADABLE', 'Could not read the Excel file');
  }
  const ws = wb.getWorksheet('Products') ?? wb.worksheets[0];
  if (!ws) throw new ImportFileError('ERR_IMPORT_EMPTY', 'The workbook has no sheets');
  const table: Array<{ line: number; cells: string[] }> = [];
  ws.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    const cells: string[] = [];
    for (let c = 1; c <= Math.max(row.cellCount, IMPORT_COLUMNS.length); c++) cells.push(cellText(row.getCell(c).value));
    table.push({ line: rowNumber, cells });
  });
  return toRows(table);
}

/** RFC 4180-style CSV (quoted fields, doubled quotes, CRLF/LF), BOM-tolerant, with ',', ';' or tab delimiters. */
export function parseCsvText(text: string): Array<{ line: number; cells: string[] }> {
  const src = text.replace(/^﻿/, '');
  const firstLine = src.split(/\r?\n/).find((l) => l.trim() && !l.startsWith('#')) ?? '';
  const delimiter = [',', ';', '\t'].reduce((best, d) => (firstLine.split(d).length > firstLine.split(best).length ? d : best), ',');

  const out: Array<{ line: number; cells: string[] }> = [];
  let cells: string[] = [];
  let field = '';
  let quoted = false;
  let line = 1;
  let recordLine = 1;
  const endRecord = () => {
    cells.push(field);
    if (!(cells.length === 1 && cells[0].startsWith('#'))) out.push({ line: recordLine, cells });
    cells = [];
    field = '';
  };
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else {
        if (ch === '\n') line++;
        field += ch;
      }
      continue;
    }
    if (ch === '"' && field === '') quoted = true;
    else if (ch === delimiter) {
      cells.push(field);
      field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i++;
      endRecord();
      line++;
      recordLine = line;
    } else field += ch;
  }
  if (field !== '' || cells.length) endRecord();
  // Comment lines carry whole text in cell 0 only when unquoted and unsplit; drop any that start with '#'.
  return out.filter((r) => !(r.cells[0] ?? '').startsWith('#'));
}

export async function parseUpload(fileName: string, buffer: Buffer): Promise<ParsedUpload> {
  const lower = fileName.toLowerCase();
  const isZip = buffer.length > 3 && buffer[0] === 0x50 && buffer[1] === 0x4b; // .xlsx is a zip ("PK")
  if (lower.endsWith('.xlsx') || isZip) return parseXlsx(buffer);
  if (lower.endsWith('.csv') || lower.endsWith('.txt')) return toRows(parseCsvText(buffer.toString('utf8')));
  if (lower.endsWith('.xls')) throw new ImportFileError('ERR_IMPORT_UNSUPPORTED_TYPE', 'Old .xls files are not supported — save as .xlsx or .csv');
  throw new ImportFileError('ERR_IMPORT_UNSUPPORTED_TYPE', 'Upload an .xlsx or .csv file');
}
