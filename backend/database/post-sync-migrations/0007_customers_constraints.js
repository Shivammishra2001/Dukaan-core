'use strict';

const { isPostgres } = require('../dialect-helper');

/** DATABASE_SCHEMA.md §6.1. */
module.exports = {
  async up(trx) {
    if (!isPostgres(trx)) { console.warn('[migration] 0007_customers_constraints.js skipped under non-Postgres dialect'); return; }
    await trx.raw(`
      ALTER TABLE customers
        ADD CONSTRAINT uq_customer_phone UNIQUE (store_id, phone_hash)
    `);
    await trx.raw(`
      ALTER TABLE customers
        ADD CONSTRAINT ck_customers_credit_limit_nonneg CHECK (credit_limit_paise >= 0)
    `);

    await trx.raw(`CREATE INDEX idx_customers_store ON customers(store_id) WHERE is_active`);
    await trx.raw(`CREATE INDEX idx_customers_last4 ON customers(store_id, phone_last_4)`);
    await trx.raw(`CREATE INDEX idx_customers_name_trgm ON customers USING gin (name gin_trgm_ops)`);
    await trx.raw(`CREATE INDEX idx_customers_updated ON customers(store_id, updated_at, id)`);
    await trx.raw(`
      CREATE INDEX idx_customers_dues ON customers(store_id, current_balance_paise DESC)
        WHERE current_balance_paise > 0
    `);
  },
  async down(trx) {
    if (!isPostgres(trx)) { console.warn('[migration] 0007_customers_constraints.js skipped under non-Postgres dialect'); return; }
    await trx.raw('DROP INDEX IF EXISTS idx_customers_dues');
    await trx.raw('DROP INDEX IF EXISTS idx_customers_updated');
    await trx.raw('DROP INDEX IF EXISTS idx_customers_name_trgm');
    await trx.raw('DROP INDEX IF EXISTS idx_customers_last4');
    await trx.raw('DROP INDEX IF EXISTS idx_customers_store');
    await trx.raw('ALTER TABLE customers DROP CONSTRAINT IF EXISTS ck_customers_credit_limit_nonneg');
    await trx.raw('ALTER TABLE customers DROP CONSTRAINT IF EXISTS uq_customer_phone');
  },
};
