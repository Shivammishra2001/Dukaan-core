import type { CreateOrderResponse } from '@/types/checkout';

/**
 * REQUIREMENTS.md §4.4 (WhatsApp receipt payload): "MVP uses a share deep
 * link only (no Business API)." Rule WA-2 caps line items at 10.
 *
 * Rule WA-1 requires E.164 normalisation of the customer's phone — but
 * `CustomerLite` only ever carries `phone_last4` (Milestone 1's
 * pii-crypto.ts deliberately never ships the full phone number to the
 * client). So there is no phone number here to build a targeted
 * `wa.me/{phone}` link from; `sharePayload.phone_e164` stays undefined in
 * this app, and the link below falls back to WhatsApp's own contact
 * picker (`wa.me/?text=...`), or better, the native share sheet via the
 * Web Share API, which needs no phone number at all.
 */

const MAX_LINE_ITEMS = 10;

export function buildWhatsAppReceiptText(order: CreateOrderResponse, language: 'hi' | 'en' = 'en'): string {
  const p = order.print_payload;
  const lines = p.lines.slice(0, MAX_LINE_ITEMS);
  const itemLines = lines.map((l) => `${l.name} x${l.qty_display} - ${l.amount_display}`).join('\n');
  const truncatedNote = p.lines.length > MAX_LINE_ITEMS ? `\n...+${p.lines.length - MAX_LINE_ITEMS} more items` : '';

  if (language === 'hi') {
    return (
      `नमस्ते${p.meta.customer ? ` ${p.meta.customer.name}` : ''} 🙏\n` +
      `${p.header.store_name} से खरीद: ₹${p.totals_block.find((t) => t.emphasis)?.value ?? ''}\n` +
      `बिल नंबर: ${p.meta.invoice_no} · दिनांक: ${p.meta.date_display}\n\n` +
      `${itemLines}${truncatedNote}` +
      (p.credit_block ? `\n\nअब तक कुल बकाया: ₹${p.credit_block.new_balance}` : '') +
      `\nधन्यवाद!`
    );
  }

  return (
    `Hi${p.meta.customer ? ` ${p.meta.customer.name}` : ''},\n` +
    `Purchase at ${p.header.store_name}: Total ${p.totals_block.find((t) => t.emphasis)?.value ?? ''}\n` +
    `Invoice: ${p.meta.invoice_no} · Date: ${p.meta.date_display}\n\n` +
    `${itemLines}${truncatedNote}` +
    (p.credit_block ? `\n\nOutstanding balance: ${p.credit_block.new_balance}` : '') +
    `\nThank you!`
  );
}

export function buildWhatsAppUrl(text: string, phoneE164?: string): string {
  const base = phoneE164 ? `https://wa.me/${phoneE164}` : 'https://wa.me/';
  return `${base}?text=${encodeURIComponent(text)}`;
}

/**
 * Prefers the native share sheet (lets the operator pick WhatsApp *with*
 * the PDF attached, and pick any contact); falls back to the text-only
 * `wa.me` deep link, which can't carry a file attachment through the URL.
 */
export async function shareReceipt(order: CreateOrderResponse, pdfBlob: Blob | null, filename: string, language: 'hi' | 'en' = 'en'): Promise<'shared' | 'opened-link' | 'failed'> {
  const text = buildWhatsAppReceiptText(order, language);

  if (pdfBlob && typeof navigator !== 'undefined' && navigator.canShare) {
    const file = new File([pdfBlob], filename, { type: 'application/pdf' });
    if (navigator.canShare({ files: [file] })) {
      try {
        await navigator.share({ files: [file], text, title: order.print_payload.meta.invoice_no });
        return 'shared';
      } catch {
        // user cancelled, or share failed — fall through to the link
      }
    }
  }

  if (typeof window === 'undefined') return 'failed';
  window.open(buildWhatsAppUrl(text), '_blank', 'noopener,noreferrer');
  return 'opened-link';
}
