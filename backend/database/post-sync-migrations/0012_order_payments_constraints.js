'use strict';

const { isPostgres } = require('../dialect-helper');

/** DATABASE_SCHEMA.md §5.5. */
module.exports = {
  async up(trx) {
    if (!isPostgres(trx)) { console.warn('[migration] 0012_order_payments_constraints.js skipped under non-Postgres dialect'); return; }
    await trx.raw(`ALTER TABLE order_payments ADD CONSTRAINT ck_payments_amount_positive CHECK (amount_paise > 0)`);
    await trx.raw(`CREATE INDEX idx_payments_order ON order_payments(order_id)`);
    await trx.raw(`CREATE INDEX idx_payments_method_date ON order_payments(store_id, method, created_at)`);
  },
  async down(trx) {
    if (!isPostgres(trx)) { console.warn('[migration] 0012_order_payments_constraints.js skipped under non-Postgres dialect'); return; }
    await trx.raw('DROP INDEX IF EXISTS idx_payments_method_date');
    await trx.raw('DROP INDEX IF EXISTS idx_payments_order');
    await trx.raw('ALTER TABLE order_payments DROP CONSTRAINT IF EXISTS ck_payments_amount_positive');
  },
};
