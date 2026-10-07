import type { PrintPayload } from '@/types/checkout';
import { buildEscPosReceipt, type PaperWidth } from './receipt-printer';

/**
 * SYSTEM_ARCHITECTURE.md §6.3: "Transports, in preference order: WebUSB ->
 * Web Serial -> Web Bluetooth -> Local Print Bridge -> window.print()."
 * Web Serial and the local bridge agent aren't implemented here (no
 * hardware/agent to test against in this environment) — this covers
 * WebUSB, Web Bluetooth, and the window.print() fallback, which is also
 * "never on the transaction path": this always runs after the sale is
 * already committed (checkout-modal.tsx only calls it post-success), so a
 * print failure can never lose or corrupt a bill.
 */

export interface PrintCapabilities {
  webUsb: boolean;
  webBluetooth: boolean;
}

export function detectPrintCapabilities(): PrintCapabilities {
  return {
    webUsb: typeof navigator !== 'undefined' && 'usb' in navigator,
    webBluetooth: typeof navigator !== 'undefined' && 'bluetooth' in navigator,
  };
}

export type PrintTransport = 'usb' | 'bluetooth' | 'window-print';

export interface PrintResult {
  ok: boolean;
  transport: PrintTransport;
  error?: string;
}

async function printViaWebUsb(bytes: Uint8Array<ArrayBuffer>): Promise<void> {
  // Class-compliant ESC/POS USB printers have no single vendor/product id —
  // an empty filter list lets the operator pick from the browser's own
  // device chooser (the standard pattern for this device class).
  const device = await navigator.usb.requestDevice({ filters: [] });
  await device.open();
  if (device.configuration === null) await device.selectConfiguration(1);
  const iface = device.configuration!.interfaces[0];
  await device.claimInterface(iface.interfaceNumber);
  const outEndpoint = iface.alternates[0].endpoints.find((e) => e.direction === 'out');
  if (!outEndpoint) throw new Error('No OUT endpoint on USB printer');
  await device.transferOut(outEndpoint.endpointNumber, bytes);
  await device.close();
}

// Widely-used (not universal) service/characteristic pair for generic
// ESC/POS Bluetooth thermal printers — vendor firmware varies; a real
// deployment should make this configurable per certified printer model.
const BT_PRINT_SERVICE_UUID = '000018f0-0000-1000-8000-00805f9b34fb';
const BT_PRINT_CHARACTERISTIC_UUID = '00002af1-0000-1000-8000-00805f9b34fb';
const BLE_MTU_CHUNK = 180; // conservative default write-without-response chunk size

async function printViaWebBluetooth(bytes: Uint8Array<ArrayBuffer>): Promise<void> {
  const device = await navigator.bluetooth.requestDevice({
    filters: [{ services: [BT_PRINT_SERVICE_UUID] }],
  });
  const server = await device.gatt?.connect();
  if (!server) throw new Error('Could not connect to printer GATT server');
  const service = await server.getPrimaryService(BT_PRINT_SERVICE_UUID);
  const characteristic = await service.getCharacteristic(BT_PRINT_CHARACTERISTIC_UUID);
  for (let offset = 0; offset < bytes.length; offset += BLE_MTU_CHUNK) {
    await characteristic.writeValueWithoutResponse(bytes.slice(offset, offset + BLE_MTU_CHUNK));
  }
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** `@media print` tuned for continuous thermal roll paper — no page breaks, width matches the roll. */
function buildPrintableHtml(payload: PrintPayload, paperWidth: PaperWidth): string {
  const mm = paperWidth === '58mm' ? 58 : 80;
  const rows = (label: string, value: string, emphasis?: boolean) =>
    `<div class="row${emphasis ? ' emphasis' : ''}"><span>${escapeHtml(label)}</span><span>${escapeHtml(value)}</span></div>`;

  return `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<title>${escapeHtml(payload.meta.invoice_no)}</title>
<style>
  @page { size: ${mm}mm auto; margin: 0; }
  * { box-sizing: border-box; }
  body { width: ${mm}mm; margin: 0; padding: 2mm; font-family: 'Courier New', monospace; font-size: 11px; color: #000; }
  .center { text-align: center; }
  .bold { font-weight: 700; }
  .large { font-size: 16px; }
  hr { border: none; border-top: 1px dashed #000; margin: 4px 0; }
  .row { display: flex; justify-content: space-between; gap: 8px; }
  .row.emphasis { font-weight: 700; font-size: 13px; }
  .line-name { margin-top: 4px; }
  @media print { body { -webkit-print-color-adjust: exact; } }
</style>
</head>
<body>
  <div class="center bold large">${escapeHtml(payload.header.store_name)}</div>
  ${payload.header.address_lines.map((l) => `<div class="center">${escapeHtml(l)}</div>`).join('')}
  ${payload.header.phone ? `<div class="center">Ph: ${escapeHtml(payload.header.phone)}</div>` : ''}
  ${payload.header.gstin ? `<div class="center">GSTIN: ${escapeHtml(payload.header.gstin)}</div>` : ''}
  ${payload.mark_provisional ? '<div class="center bold">*** PROVISIONAL / अस्थायी ***</div>' : ''}
  <hr />
  <div>Inv: ${escapeHtml(payload.meta.invoice_no)}</div>
  <div>${escapeHtml(payload.meta.date_display)} ${escapeHtml(payload.meta.time_display)}</div>
  <div>Cashier: ${escapeHtml(payload.meta.cashier)}${payload.meta.counter ? ` &middot; Ctr: ${escapeHtml(payload.meta.counter)}` : ''}</div>
  ${payload.meta.customer ? `<div>Customer: ${escapeHtml(payload.meta.customer.name)}</div>` : ''}
  <hr />
  ${payload.lines
    .map(
      (l) =>
        `<div class="line-name">${escapeHtml(l.name)}</div>${rows(`${l.qty_display} x ${l.rate_display}`, l.amount_display)}`
    )
    .join('')}
  <hr />
  ${payload.totals_block.map((t) => rows(t.label, t.value, t.emphasis)).join('')}
  ${
    payload.tax_block?.length
      ? `<hr />${payload.tax_block.map((t) => `<div class="row"><span>${t.rate}</span><span>${t.taxable}</span><span>${t.cgst}</span><span>${t.sgst}</span></div>`).join('')}`
      : ''
  }
  <hr />
  <div class="bold">PAYMENTS</div>
  ${payload.payments_block.map((p) => rows(p.label, p.value)).join('')}
  ${
    payload.credit_block
      ? `<hr />${rows('Previous due', payload.credit_block.previous_balance)}${rows('This bill', payload.credit_block.this_bill)}${rows('Total due', payload.credit_block.new_balance, true)}`
      : ''
  }
  <hr />
  ${payload.footer_lines.map((f) => `<div class="center">${escapeHtml(f)}</div>`).join('')}
  <script>window.onload = () => { window.print(); };</script>
</body>
</html>`;
}

function printViaWindowPrint(payload: PrintPayload, paperWidth: PaperWidth): void {
  const win = window.open('', '_blank', 'width=400,height=600');
  if (!win) throw new Error('Popup blocked — allow popups to print');
  win.document.write(buildPrintableHtml(payload, paperWidth));
  win.document.close();
}

/**
 * Tries hardware transports in preference order, falling back to
 * `window.print()`. Never throws — a print failure is always recoverable
 * via the Reprint affordance (SYSTEM_ARCHITECTURE.md §6.3), so callers only
 * need the boolean result.
 */
export async function dispatchPrint(payload: PrintPayload, paperWidth: PaperWidth = '58mm'): Promise<PrintResult> {
  const caps = detectPrintCapabilities();
  const bytes = buildEscPosReceipt(payload, paperWidth);

  if (caps.webUsb) {
    try {
      await printViaWebUsb(bytes);
      return { ok: true, transport: 'usb' };
    } catch (err) {
      // fall through to the next transport
      void err;
    }
  }
  if (caps.webBluetooth) {
    try {
      await printViaWebBluetooth(bytes);
      return { ok: true, transport: 'bluetooth' };
    } catch (err) {
      void err;
    }
  }
  try {
    printViaWindowPrint(payload, paperWidth);
    return { ok: true, transport: 'window-print' };
  } catch (err) {
    return { ok: false, transport: 'window-print', error: err instanceof Error ? err.message : 'Print failed' };
  }
}
