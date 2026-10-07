'use strict';

/**
 * Stores created by stores-onboard's raw Knex insert never got schema.json's
 * `invoice_prefix` default, so their invoices were numbered
 * `null/2026-27/C1/000001`. Backfills a prefix from the store name's initials
 * ("Harshit Enterprises" -> "HE"), else the store code, else "INV" — the same
 * order as src/services/invoice-prefix.ts, which also applies it at runtime
 * (duplicated here because migrations run as plain JS). Already-issued
 * invoice numbers are left untouched: they are fiscal documents.
 */
function initials(name) {
  const words = String(name || '').match(/[A-Za-z0-9]+/g) || [];
  return words.map((w) => w[0]).join('').toUpperCase().slice(0, 10);
}

function sanitize(value) {
  const cleaned = String(value == null ? '' : value).trim().toUpperCase().replace(/[^A-Z0-9-]/g, '');
  return cleaned === 'NULL' ? '' : cleaned.slice(0, 10);
}

module.exports = {
  async up(trx) {
    const stores = await trx('stores').select('id', 'name', 'code', 'invoice_prefix');
    for (const store of stores) {
      if (sanitize(store.invoice_prefix)) continue;
      const prefix = initials(store.name) || sanitize(store.code) || 'INV';
      await trx('stores').where({ id: store.id }).update({ invoice_prefix: prefix });
    }
  },
  async down() {
    // Not reversible: the previous values were NULL/empty, which is the bug.
  },
};
