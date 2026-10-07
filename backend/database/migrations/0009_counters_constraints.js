'use strict';

const { isPostgres } = require('../dialect-helper');

/** DATABASE_SCHEMA.md §2.4. */
module.exports = {
  async up(trx) {
    if (!isPostgres(trx)) { console.warn('[migration] 0009_counters_constraints.js skipped under non-Postgres dialect'); return; }
    await trx.raw(`ALTER TABLE counters ADD CONSTRAINT uq_counter_code UNIQUE (store_id, code)`);
  },
  async down(trx) {
    if (!isPostgres(trx)) { console.warn('[migration] 0009_counters_constraints.js skipped under non-Postgres dialect'); return; }
    await trx.raw('ALTER TABLE counters DROP CONSTRAINT IF EXISTS uq_counter_code');
  },
};
