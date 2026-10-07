'use strict';

const { isPostgres } = require('../dialect-helper');

/**
 * DATABASE_SCHEMA.md §4.1. The FEFO index is the hot path for
 * inventory.service.allocateFEFO() (REQUIREMENTS.md §3.2) — partial +
 * NULLS LAST indexes are not expressible from schema.json.
 */
module.exports = {
  async up(trx) {
    if (!isPostgres(trx)) { console.warn('[migration] 0006_inventory_batches_constraints.js skipped under non-Postgres dialect'); return; }
    await trx.raw(`ALTER TABLE inventory_batches ALTER COLUMN opening_stock_base TYPE numeric(18,4) USING opening_stock_base::numeric(18,4)`);
    await trx.raw(`ALTER TABLE inventory_batches ALTER COLUMN current_stock_base TYPE numeric(18,4) USING current_stock_base::numeric(18,4)`);
    await trx.raw(`ALTER TABLE inventory_batches ALTER COLUMN reserved_base TYPE numeric(18,4) USING reserved_base::numeric(18,4)`);

    await trx.raw(`
      ALTER TABLE inventory_batches
        ADD CONSTRAINT uq_batch UNIQUE (store_id, product_id, batch_no, expiry_date)
    `);
    await trx.raw(`
      ALTER TABLE inventory_batches
        ADD CONSTRAINT ck_batches_status CHECK (status IN ('ACTIVE','QUARANTINE','WRITTEN_OFF','CLOSED'))
    `);

    await trx.raw(`
      CREATE INDEX idx_batches_fefo ON inventory_batches
        (store_id, product_id, expiry_date NULLS LAST, received_at, id)
        WHERE status = 'ACTIVE' AND current_stock_base > 0
    `);
    await trx.raw(`
      CREATE INDEX idx_batches_expiry ON inventory_batches (store_id, expiry_date)
        WHERE status = 'ACTIVE' AND current_stock_base > 0 AND expiry_date IS NOT NULL
    `);
    await trx.raw(`
      CREATE INDEX idx_batches_updated ON inventory_batches (store_id, updated_at, id)
    `);
  },
  async down(trx) {
    if (!isPostgres(trx)) { console.warn('[migration] 0006_inventory_batches_constraints.js skipped under non-Postgres dialect'); return; }
    await trx.raw('DROP INDEX IF EXISTS idx_batches_updated');
    await trx.raw('DROP INDEX IF EXISTS idx_batches_expiry');
    await trx.raw('DROP INDEX IF EXISTS idx_batches_fefo');
    await trx.raw('ALTER TABLE inventory_batches DROP CONSTRAINT IF EXISTS ck_batches_status');
    await trx.raw('ALTER TABLE inventory_batches DROP CONSTRAINT IF EXISTS uq_batch');
  },
};
