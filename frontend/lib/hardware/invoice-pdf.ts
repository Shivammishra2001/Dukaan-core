import type { CreateOrderResponse } from '@/types/checkout';

/**
 * 100% offline-safe: takes an already-fetched/cached `CreateOrderResponse`
 * (local order data) and renders a PDF entirely client-side — zero server
 * round-trips. `jspdf` is dynamically imported (never a static top-level
 * import) specifically so it never lands in the `/pos` route's initial
 * bundle — see the Milestone 5 bundle-budget requirement; it only loads
 * when the operator actually clicks a PDF/WhatsApp button.
 */

export type PdfTemplate = 'THERMAL_80MM' | 'A4_TAX_INVOICE';

export interface BankDetails {
  account_name: string;
  account_number: string;
  ifsc: string;
  bank_name: string;
}

export interface InvoicePdfOptions {
  bankDetails?: BankDetails;
  termsAndConditions?: string[];
}

const DEFAULT_TERMS = [
  'Goods once sold will not be taken back.',
  'Subject to local jurisdiction.',
  'This is a computer-generated invoice.',
];

async function loadJsPdf() {
  const mod = await import('jspdf');
  return mod.jsPDF;
}

function generateThermalSlip(order: CreateOrderResponse, JsPDF: Awaited<ReturnType<typeof loadJsPdf>>): InstanceType<typeof JsPDF> {
  const p = order.print_payload;
  const widthMm = 80;
  // Rough line-height budget so the page is exactly as tall as the content — a
  // continuous "roll" feel rather than a fixed A4-shaped slip.
  const estimatedLines = 14 + order.items.length * 2 + p.payments_block.length + p.totals_block.length + (p.tax_block?.length ?? 0) + p.footer_lines.length;
  const heightMm = Math.max(120, estimatedLines * 4.6);

  const doc = new JsPDF({ unit: 'mm', format: [widthMm, heightMm] });
  const marginX = 4;
  const contentWidth = widthMm - marginX * 2;
  let y = 8;
  const lineGap = 4.6;

  const center = (text: string, size = 10, bold = false) => {
    doc.setFont('courier', bold ? 'bold' : 'normal');
    doc.setFontSize(size);
    doc.text(text, widthMm / 2, y, { align: 'center', maxWidth: contentWidth });
    y += lineGap;
  };
  const left = (text: string, size = 8) => {
    doc.setFont('courier', 'normal');
    doc.setFontSize(size);
    doc.text(text, marginX, y, { maxWidth: contentWidth });
    y += lineGap;
  };
  const rowLR = (l: string, r: string, bold = false) => {
    doc.setFont('courier', bold ? 'bold' : 'normal');
    doc.setFontSize(bold ? 10 : 8.5);
    doc.text(l, marginX, y);
    doc.text(r, widthMm - marginX, y, { align: 'right' });
    y += lineGap;
  };
  const rule = () => {
    doc.setLineDashPattern([1, 1], 0);
    doc.line(marginX, y, widthMm - marginX, y);
    y += lineGap * 0.7;
  };

  center(p.header.store_name, 13, true);
  p.header.address_lines.forEach((l) => center(l, 8));
  if (p.header.phone) center(`Ph: ${p.header.phone}`, 8);
  if (p.header.gstin) center(`GSTIN: ${p.header.gstin}`, 8);
  if (p.mark_provisional) center('*** PROVISIONAL / अस्थायी ***', 9, true);
  rule();

  left(`Inv: ${p.meta.invoice_no}`);
  left(`${p.meta.date_display}  ${p.meta.time_display}`);
  left(`Cashier: ${p.meta.cashier}`);
  if (p.meta.customer) left(`Customer: ${p.meta.customer.name}`);
  rule();

  for (const line of p.lines) {
    left(line.name, 8.5);
    rowLR(`${line.qty_display} x ${line.rate_display}`, line.amount_display);
  }
  rule();

  for (const t of p.totals_block) rowLR(t.label, t.value, t.emphasis);
  if (p.tax_block?.length) {
    rule();
    for (const t of p.tax_block) left(`GST ${t.rate}: Taxable ${t.taxable}  CGST ${t.cgst}  SGST ${t.sgst}`, 7.5);
  }
  rule();

  left('PAYMENTS', 8.5);
  for (const pm of p.payments_block) rowLR(pm.label, pm.value);
  if (p.credit_block) {
    rule();
    rowLR('Previous due', p.credit_block.previous_balance);
    rowLR('This bill', p.credit_block.this_bill);
    rowLR('Total due', p.credit_block.new_balance, true);
  }
  rule();
  p.footer_lines.forEach((f) => center(f, 8));

  return doc;
}

function generateA4TaxInvoice(
  order: CreateOrderResponse,
  JsPDF: Awaited<ReturnType<typeof loadJsPdf>>,
  options?: InvoicePdfOptions
): InstanceType<typeof JsPDF> {
  const p = order.print_payload;
  const doc = new JsPDF({ unit: 'mm', format: 'a4' });
  const pageWidth = 210;
  const marginX = 15;
  let y = 18;

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(18);
  doc.text('TAX INVOICE', pageWidth / 2, y, { align: 'center' });
  y += 8;

  doc.setFontSize(13);
  doc.text(p.header.store_name, marginX, y);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  y += 5;
  p.header.address_lines.forEach((l) => {
    doc.text(l, marginX, y);
    y += 4;
  });
  if (p.header.gstin) {
    doc.text(`GSTIN: ${p.header.gstin}`, marginX, y);
    y += 4;
  }
  if (p.header.phone) {
    doc.text(`Phone: ${p.header.phone}`, marginX, y);
    y += 4;
  }

  // Invoice meta, right column
  const rightX = pageWidth - marginX;
  let metaY = 26;
  doc.setFontSize(9);
  doc.text(`Invoice No: ${p.meta.invoice_no}`, rightX, metaY, { align: 'right' });
  metaY += 4;
  doc.text(`Date: ${p.meta.date_display} ${p.meta.time_display}`, rightX, metaY, { align: 'right' });
  metaY += 4;
  doc.text(`Supply Type: ${order.order.supply_type}`, rightX, metaY, { align: 'right' });
  if (p.meta.customer) {
    metaY += 4;
    doc.text(`Bill To: ${p.meta.customer.name}`, rightX, metaY, { align: 'right' });
  }

  y = Math.max(y, metaY) + 6;
  doc.setLineWidth(0.3);
  doc.line(marginX, y, pageWidth - marginX, y);
  y += 6;

  // Item table — hand-drawn columns (no autotable dependency, keeps this lazy chunk small)
  const cols = [
    { key: 'name', label: 'Item', x: marginX, w: 55 },
    { key: 'hsn', label: 'HSN', x: marginX + 55, w: 18 },
    { key: 'qty', label: 'Qty', x: marginX + 73, w: 16 },
    { key: 'rate', label: 'Rate', x: marginX + 89, w: 18 },
    { key: 'taxable', label: 'Taxable', x: marginX + 107, w: 22 },
    { key: 'gst', label: 'GST%', x: marginX + 129, w: 14 },
    { key: 'cgst', label: 'CGST', x: marginX + 143, w: 16 },
    { key: 'sgst', label: 'SGST', x: marginX + 159, w: 16 },
    { key: 'total', label: 'Total', x: pageWidth - marginX, w: 0 }, // right-aligned to margin
  ] as const;

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8);
  for (const c of cols) {
    if (c.key === 'total') doc.text(c.label, c.x, y, { align: 'right' });
    else doc.text(c.label, c.x, y);
  }
  y += 2;
  doc.line(marginX, y, pageWidth - marginX, y);
  y += 4;

  doc.setFont('helvetica', 'normal');
  for (const item of order.items) {
    if (y > 270) {
      doc.addPage();
      y = 20;
    }
    const row: Record<string, string> = {
      name: item.product_name,
      hsn: item.product_id ? '' : '', // placeholder resolved below
      qty: `${item.entered_qty} ${item.entered_unit}`,
      rate: (item.unit_price_paise / 100).toFixed(2),
      taxable: (item.taxable_value_paise / 100).toFixed(2),
      gst: `${item.gst_rate}%`,
      cgst: (item.cgst_paise / 100).toFixed(2),
      sgst: (item.sgst_paise / 100).toFixed(2),
      total: (item.line_total_paise / 100).toFixed(2),
    };
    for (const c of cols) {
      const text = c.key === 'hsn' ? (item.hsn_code ?? '-') : row[c.key];
      const truncated = c.w > 0 ? doc.splitTextToSize(text, c.w)[0] : text;
      if (c.key === 'total') doc.text(truncated, c.x, y, { align: 'right' });
      else doc.text(truncated, c.x, y);
    }
    y += 5;
  }
  y += 2;
  doc.line(marginX, y, pageWidth - marginX, y);
  y += 6;

  // Totals block, right-aligned
  const totalsX = pageWidth - marginX;
  doc.setFontSize(9);
  for (const t of p.totals_block) {
    doc.setFont('helvetica', t.emphasis ? 'bold' : 'normal');
    doc.text(`${t.label}: ${t.value}`, totalsX, y, { align: 'right' });
    y += 5;
  }
  y += 4;

  if (order.customer) {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.text(
      `Customer balance: previous ${((order.customer.balance_before_paise) / 100).toFixed(2)} -> now ${(order.customer.balance_after_paise / 100).toFixed(2)}`,
      marginX,
      y
    );
    y += 6;
  }

  if (options?.bankDetails) {
    doc.setFont('helvetica', 'bold');
    doc.text('Bank Details', marginX, y);
    y += 5;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8.5);
    const b = options.bankDetails;
    doc.text(`A/c Name: ${b.account_name}   A/c No: ${b.account_number}`, marginX, y);
    y += 4;
    doc.text(`IFSC: ${b.ifsc}   Bank: ${b.bank_name}`, marginX, y);
    y += 8;
  }

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8.5);
  doc.text('Terms & Conditions', marginX, y);
  y += 4;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7.5);
  for (const term of options?.termsAndConditions ?? DEFAULT_TERMS) {
    doc.text(`- ${term}`, marginX, y);
    y += 3.5;
  }

  return doc;
}

export async function generateInvoicePdf(order: CreateOrderResponse, template: PdfTemplate, options?: InvoicePdfOptions): Promise<Blob> {
  const JsPDF = await loadJsPdf();
  const doc = template === 'THERMAL_80MM' ? generateThermalSlip(order, JsPDF) : generateA4TaxInvoice(order, JsPDF, options);
  return doc.output('blob');
}

export function invoicePdfFilename(order: CreateOrderResponse, template: PdfTemplate): string {
  const safeInvoiceNo = order.order.invoice_no.replace(/[^\w-]+/g, '_');
  return `${template === 'THERMAL_80MM' ? 'slip' : 'invoice'}_${safeInvoiceNo}.pdf`;
}
