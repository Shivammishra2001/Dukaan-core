/**
 * Invoice series prefix for `PREFIX/FY/COUNTER/SEQUENCE` numbers
 * (DATABASE_SCHEMA.md §5.6). Stores created through raw Knex inserts
 * (stores-onboard) bypass schema.json's `default: "INV"`, leaving
 * invoice_prefix NULL — which rendered invoice numbers like
 * `null/2026-27/C1/000001`. Resolution order:
 *   1. the store's own invoice_prefix, when set;
 *   2. initials of the store name ("Harshit Enterprises" -> "HE");
 *   3. the store code;
 *   4. "INV".
 * Output is uppercase A-Z/0-9/'-' only (never '/', which is the series
 * separator), at most 10 characters (schema.json maxLength).
 */

const MAX_PREFIX_LENGTH = 10;

function sanitize(value: unknown): string {
  if (value == null) return '';
  const cleaned = String(value).trim().toUpperCase().replace(/[^A-Z0-9-]/g, '');
  return cleaned === 'NULL' || cleaned === 'UNDEFINED' ? '' : cleaned.slice(0, MAX_PREFIX_LENGTH);
}

/** First letter/digit of each Latin-script word: "Scope Test Kirana" -> "STK". Empty for names with no ASCII words. */
export function storeInitials(name: unknown): string {
  if (name == null) return '';
  const words = String(name).match(/[A-Za-z0-9]+/g) ?? [];
  return words.map((w) => w[0]).join('').toUpperCase().slice(0, MAX_PREFIX_LENGTH);
}

export function resolveInvoicePrefix(store: { invoice_prefix?: unknown; name?: unknown; code?: unknown }): string {
  return sanitize(store.invoice_prefix) || storeInitials(store.name) || sanitize(store.code) || 'INV';
}
