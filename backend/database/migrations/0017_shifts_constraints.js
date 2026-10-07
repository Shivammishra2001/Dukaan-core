'use strict';

const { isPostgres } = require('../dialect-helper');

/** DATABASE_SCHEMA.md §5.1. Rules SH-1/SH-2 as partial unique indexes — the actual concurrency guard, not just app-level validation. */
module.exports = {
  async up(trx) {
    if (!isPostgres(trx)) { console.warn('[migration] 0017_shifts_constraints.js skipped under non-Postgres dialect'); return; }
    await trx.raw(`
      CREATE UNIQUE INDEX uq_open_shift_per_counter ON shifts(counter_id)
        WHERE status IN ('OPEN','PENDING_COUNT')
    `);
    await trx.raw(`
      CREATE UNIQUE INDEX uq_open_shift_per_user ON shifts(store_id, cashier_id)
        WHERE status IN ('OPEN','PENDING_COUNT')
    `);
    await trx.raw(`CREATE INDEX idx_shifts_store_time ON shifts(store_id, opened_at DESC)`);
  },
  async down(trx) {
    if (!isPostgres(trx)) { console.warn('[migration] 0017_shifts_constraints.js skipped under non-Postgres dialect'); return; }
    await trx.raw('DROP INDEX IF EXISTS idx_shifts_store_time');
    await trx.raw('DROP INDEX IF EXISTS uq_open_shift_per_user');
    await trx.raw('DROP INDEX IF EXISTS uq_open_shift_per_counter');
  },
};
