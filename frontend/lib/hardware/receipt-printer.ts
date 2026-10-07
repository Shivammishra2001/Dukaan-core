import type { PrintPayload } from '@/types/checkout';

/**
 * SYSTEM_ARCHITECTURE.md §6.3 (Thermal printers). Raw ESC/POS byte
 * generator — pure functions, no DOM/hardware access here (that's
 * printer-transport.ts). `render_mode: 'RASTER'` (needed for correct
 * Devanagari per ADR-10 — thermal codepages don't reliably support Hindi)
 * is NOT implemented: that needs an offscreen-canvas → 1-bit bitmap
 * pipeline, a genuinely separate feature. This module only emits `TEXT`
 * mode, which is correct for English/numeric receipts and is what
 * `print_payload.render_mode` already exists to select between.
 */

const ESC = 0x1b;
const GS = 0x1d;

export type PaperWidth = '58mm' | '80mm';

const CHARS_PER_LINE: Record<PaperWidth, number> = { '58mm': 32, '80mm': 48 };

class ByteBuilder {
  private chunks: number[] = [];

  push(...bytes: number[]): this {
    this.chunks.push(...bytes);
    return this;
  }

  text(s: string): this {
    // CP437/Latin-1-ish single-byte encoding, matching typical ESC/POS
    // firmware defaults. Non-encodable characters (e.g. Devanagari) fall
    // back to '?' — see the module doc comment re: RASTER mode.
    for (const ch of s) {
      const code = ch.codePointAt(0) ?? 63;
      this.chunks.push(code <= 0xff ? code : 63);
    }
    return this;
  }

  line(s = ''): this {
    return this.text(s).push(0x0a);
  }

  toBytes(): Uint8Array<ArrayBuffer> {
    return new Uint8Array(this.chunks);
  }
}

function align(mode: 'left' | 'center' | 'right'): [number, number, number] {
  return [ESC, 0x61, mode === 'left' ? 0 : mode === 'center' ? 1 : 2];
}

function bold(on: boolean): [number, number, number] {
  return [ESC, 0x45, on ? 1 : 0];
}

function textSize(scaleX: 1 | 2, scaleY: 1 | 2): [number, number, number] {
  return [GS, 0x21, ((scaleX - 1) << 4) | (scaleY - 1)];
}

function feed(lines: number): [number, number, number] {
  return [ESC, 0x64, lines];
}

/** REQUIREMENTS.md-adjacent hardware spec: paper cut, partial cut ('B' = 66), no feed before cut. */
function cutCommand(): [number, number, number, number] {
  return [GS, 0x56, 66, 0];
}

/** `ESC p 0 25 250` — kick the drawer wired through the printer (SYSTEM_ARCHITECTURE.md §6.4). */
function drawerKickCommand(): [number, number, number, number, number] {
  return [ESC, 0x70, 0, 25, 250];
}

/** Standard Epson-compatible `GS ( k` QR sequence — model 2, size 4, error-correction M. */
function qrCodeCommand(data: string): number[] {
  const bytes = Array.from(new TextEncoder().encode(data));
  const storeLen = bytes.length + 3;
  const pL = storeLen & 0xff;
  const pH = (storeLen >> 8) & 0xff;
  return [
    // Model 2
    GS, 0x28, 0x6b, 0x04, 0x00, 0x31, 0x41, 0x32, 0x00,
    // Size = 4
    GS, 0x28, 0x6b, 0x03, 0x00, 0x31, 0x43, 0x04,
    // Error correction = M (49)
    GS, 0x28, 0x6b, 0x03, 0x00, 0x31, 0x45, 0x31,
    // Store data
    GS, 0x28, 0x6b, pL, pH, 0x31, 0x50, 0x30, ...bytes,
    // Print
    GS, 0x28, 0x6b, 0x03, 0x00, 0x31, 0x51, 0x30,
  ];
}

function padColumns(cols: { text: string; width: number; align?: 'left' | 'right' }[]): string {
  return cols
    .map((c) => {
      const truncated = c.text.slice(0, c.width);
      return c.align === 'right' ? truncated.padStart(c.width) : truncated.padEnd(c.width);
    })
    .join('');
}

function ruleLine(width: number): string {
  return '-'.repeat(width);
}

/** Wraps a line into `width`-char chunks on word boundaries (for long item names). */
function wrapText(text: string, width: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = '';
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (candidate.length > width) {
      if (current) lines.push(current);
      current = word.slice(0, width);
    } else {
      current = candidate;
    }
  }
  if (current) lines.push(current);
  return lines.length ? lines : [''];
}

/**
 * REQUIREMENTS.md/API_CONTRACTS.md `print_payload` shape (already built in
 * Milestone 3) is the input — this never talks to the network, so it works
 * fully offline from an already-fetched/cached order response.
 */
export function buildEscPosReceipt(payload: PrintPayload, paperWidth: PaperWidth = '58mm'): Uint8Array<ArrayBuffer> {
  const width = CHARS_PER_LINE[paperWidth];
  const b = new ByteBuilder();

  b.push(ESC, 0x40); // init

  // Header — centered store identity
  b.push(...align('center'));
  b.push(...bold(true)).push(...textSize(2, 2));
  b.line(payload.header.store_name);
  b.push(...textSize(1, 1)).push(...bold(false));
  for (const addrLine of payload.header.address_lines) b.line(addrLine);
  if (payload.header.phone) b.line(`Ph: ${payload.header.phone}`);
  if (payload.header.gstin) b.line(`GSTIN: ${payload.header.gstin}`);
  if (payload.mark_provisional) {
    b.push(...bold(true)).line('*** PROVISIONAL / अस्थायी ***').push(...bold(false));
  }
  b.line(ruleLine(width));

  // Meta — left aligned
  b.push(...align('left'));
  b.line(`Inv: ${payload.meta.invoice_no}`);
  b.line(`${payload.meta.date_display}  ${payload.meta.time_display}`);
  b.line(`Cashier: ${payload.meta.cashier}${payload.meta.counter ? `  Ctr: ${payload.meta.counter}` : ''}`);
  if (payload.meta.customer) {
    b.line(`Customer: ${payload.meta.customer.name}${payload.meta.customer.phone_masked ? ` (${payload.meta.customer.phone_masked})` : ''}`);
  }
  b.line(ruleLine(width));

  // Item table: Name on its own line(s) if needed, then Qty x Rate ... Total
  const qtyColWidth = Math.floor(width * 0.45);
  const amtColWidth = width - qtyColWidth;
  for (const line of payload.lines) {
    for (const wrapped of wrapText(line.name, width)) b.line(wrapped);
    b.line(
      padColumns([
        { text: `${line.qty_display} x ${line.rate_display}`, width: qtyColWidth },
        { text: line.amount_display, width: amtColWidth, align: 'right' },
      ])
    );
    if (line.batch_display) b.line(`  Batch: ${line.batch_display}`);
    if (line.note) b.line(`  ${line.note}`);
  }
  b.line(ruleLine(width));

  // Totals — GST breakdown, round-off, grand total
  for (const t of payload.totals_block) {
    if (t.emphasis) b.push(...bold(true)).push(...textSize(2, 1));
    b.line(padColumns([{ text: t.label, width: width - 12 }, { text: t.value, width: 12, align: 'right' }]));
    if (t.emphasis) b.push(...textSize(1, 1)).push(...bold(false));
  }

  if (payload.tax_block?.length) {
    b.line(ruleLine(width));
    b.line(padColumns([{ text: 'GST%', width: 8 }, { text: 'Taxable', width: Math.floor((width - 8) / 3) }, { text: 'CGST', width: Math.floor((width - 8) / 3) }, { text: 'SGST', width: Math.floor((width - 8) / 3), align: 'right' }]));
    for (const t of payload.tax_block) {
      b.line(padColumns([{ text: t.rate, width: 8 }, { text: t.taxable, width: Math.floor((width - 8) / 3) }, { text: t.cgst, width: Math.floor((width - 8) / 3) }, { text: t.sgst, width: Math.floor((width - 8) / 3), align: 'right' }]));
    }
  }
  b.line(ruleLine(width));

  // Split tenders (Cash/UPI/Card/Khata)
  b.push(...bold(true)).line('PAYMENTS').push(...bold(false));
  for (const p of payload.payments_block) {
    b.line(padColumns([{ text: p.label, width: width - 12 }, { text: p.value, width: 12, align: 'right' }]));
  }
  if (payload.credit_block) {
    b.line(ruleLine(width));
    b.line(padColumns([{ text: 'Previous due', width: width - 12 }, { text: payload.credit_block.previous_balance, width: 12, align: 'right' }]));
    b.line(padColumns([{ text: 'This bill', width: width - 12 }, { text: payload.credit_block.this_bill, width: 12, align: 'right' }]));
    b.push(...bold(true));
    b.line(padColumns([{ text: 'Total due', width: width - 12 }, { text: payload.credit_block.new_balance, width: 12, align: 'right' }]));
    b.push(...bold(false));
  }
  b.line(ruleLine(width));

  // Footer + QR for invoice verification
  b.push(...align('center'));
  for (const f of payload.footer_lines) b.line(f);
  if (payload.qr) {
    b.push(0x0a);
    b.push(...qrCodeCommand(payload.qr.data));
    b.push(0x0a);
  }

  b.push(...feed(3));
  if (payload.open_drawer) b.push(...drawerKickCommand());
  b.push(...cutCommand());

  return b.toBytes();
}

export { qrCodeCommand, drawerKickCommand, cutCommand };
