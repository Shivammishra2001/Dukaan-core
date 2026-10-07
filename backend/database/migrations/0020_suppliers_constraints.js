'use strict';

const { isPostgres } = require('../dialect-helper');

/** DATABASE_SCHEMA.md §7.1. */
module.exports = {
  async up(trx) {
    if (!isPostgres(trx)) { console.warn('[migration] 0020_suppliers_constraints.js skipped under non-Postgres dialect'); return; }
    await trx.raw(`ALTER TABLE suppliers ADD CONSTRAINT uq_supplier_phone UNIQUE (store_id, phone_hash)`);
    await trx.raw(`CREATE INDEX idx_suppliers_store ON suppliers(store_id) WHERE is_active`);
  },
  async down(trx) {
    if (!isPostgres(trx)) { console.warn('[migration] 0020_suppliers_constraints.js skipped under non-Postgres dialect'); return; }
    await trx.raw('DROP INDEX IF EXISTS idx_suppliers_store');
    await trx.raw('ALTER TABLE suppliers DROP CONSTRAINT IF EXISTS uq_supplier_phone');
  },
};
