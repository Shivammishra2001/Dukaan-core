'use strict';

const { isPostgres } = require('../dialect-helper');

/** DATABASE_SCHEMA.md §7.3. */
module.exports = {
  async up(trx) {
    if (!isPostgres(trx)) { console.warn('[migration] 0022_purchase_bills_constraints.js skipped under non-Postgres dialect'); return; }
    await trx.raw(`ALTER TABLE purchase_bills ADD CONSTRAINT uq_grn_no UNIQUE (store_id, grn_no)`);
    await trx.raw(`CREATE INDEX idx_pbills_supplier ON purchase_bills(supplier_id, business_date DESC)`);
    await trx.raw(`CREATE INDEX idx_pbills_unpaid ON purchase_bills(store_id, due_date) WHERE payment_status <> 'PAID'`);

    for (const col of ['received_qty', 'conversion_factor', 'received_qty_base', 'free_qty_base']) {
      const precision = col === 'conversion_factor' ? '18,6' : '18,4';
      await trx.raw(`ALTER TABLE purchase_bill_items ALTER COLUMN ${col} TYPE numeric(${precision}) USING ${col}::numeric(${precision})`);
    }
    await trx.raw(`ALTER TABLE purchase_bill_items ALTER COLUMN gst_rate TYPE numeric(5,2) USING gst_rate::numeric(5,2)`);
    await trx.raw(`CREATE INDEX idx_pbitems_bill ON purchase_bill_items(purchase_bill_id)`);
  },
  async down(trx) {
    if (!isPostgres(trx)) { console.warn('[migration] 0022_purchase_bills_constraints.js skipped under non-Postgres dialect'); return; }
    await trx.raw('DROP INDEX IF EXISTS idx_pbitems_bill');
    await trx.raw('DROP INDEX IF EXISTS idx_pbills_unpaid');
    await trx.raw('DROP INDEX IF EXISTS idx_pbills_supplier');
    await trx.raw('ALTER TABLE purchase_bills DROP CONSTRAINT IF EXISTS uq_grn_no');
  },
};
