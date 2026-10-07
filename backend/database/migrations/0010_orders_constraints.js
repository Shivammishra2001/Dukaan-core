'use strict';

const { isPostgres } = require('../dialect-helper');

/** DATABASE_SCHEMA.md §5.3. */
module.exports = {
  async up(trx) {
    if (!isPostgres(trx)) { console.warn('[migration] 0010_orders_constraints.js skipped under non-Postgres dialect'); return; }
    await trx.raw(`ALTER TABLE orders ADD CONSTRAINT uq_order_client_uuid UNIQUE (store_id, client_uuid)`);
    await trx.raw(`ALTER TABLE orders ADD CONSTRAINT uq_order_invoice_no UNIQUE (store_id, invoice_no)`);
    await trx.raw(`ALTER TABLE orders ADD CONSTRAINT ck_totals CHECK (total_paise = paid_paise + credit_paise)`);

    await trx.raw(`CREATE INDEX idx_orders_store_date ON orders(store_id, business_date DESC, id DESC)`);
    await trx.raw(`
      CREATE INDEX idx_orders_customer ON orders(customer_id, business_date DESC) WHERE customer_id IS NOT NULL
    `);
    await trx.raw(`
      CREATE INDEX idx_orders_unsettled ON orders(store_id, customer_id) WHERE settlement_status <> 'SETTLED'
    `);
  },
  async down(trx) {
    if (!isPostgres(trx)) { console.warn('[migration] 0010_orders_constraints.js skipped under non-Postgres dialect'); return; }
    await trx.raw('DROP INDEX IF EXISTS idx_orders_unsettled');
    await trx.raw('DROP INDEX IF EXISTS idx_orders_customer');
    await trx.raw('DROP INDEX IF EXISTS idx_orders_store_date');
    await trx.raw('ALTER TABLE orders DROP CONSTRAINT IF EXISTS ck_totals');
    await trx.raw('ALTER TABLE orders DROP CONSTRAINT IF EXISTS uq_order_invoice_no');
    await trx.raw('ALTER TABLE orders DROP CONSTRAINT IF EXISTS uq_order_client_uuid');
  },
};
