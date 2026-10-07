'use strict';

const { isPostgres } = require('../dialect-helper');

/**
 * DATABASE_SCHEMA.md §2.2. `stores.code` is only unique within a tenant, and
 * `is_active` needs a partial index — neither is expressible from schema.json.
 */
module.exports = {
  async up(trx) {
    if (!isPostgres(trx)) { console.warn('[migration] 0002_stores_constraints.js skipped under non-Postgres dialect'); return; }
    await trx.raw(`
      ALTER TABLE stores
        ADD CONSTRAINT uq_store_code UNIQUE (tenant_id, code)
    `);
    await trx.raw(`
      CREATE INDEX idx_stores_tenant ON stores(tenant_id) WHERE is_active
    `);
  },
  async down(trx) {
    if (!isPostgres(trx)) { console.warn('[migration] 0002_stores_constraints.js skipped under non-Postgres dialect'); return; }
    await trx.raw('DROP INDEX IF EXISTS idx_stores_tenant');
    await trx.raw('ALTER TABLE stores DROP CONSTRAINT IF EXISTS uq_store_code');
  },
};
