'use strict';

const { isPostgres } = require('../dialect-helper');

/** DATABASE_SCHEMA.md §3.1. */
module.exports = {
  async up(trx) {
    if (!isPostgres(trx)) { console.warn('[migration] 0003_categories_indexes.js skipped under non-Postgres dialect'); return; }
    await trx.raw(`
      CREATE INDEX idx_categories_store ON categories(store_id, sort_order) WHERE is_active
    `);
  },
  async down(trx) {
    if (!isPostgres(trx)) { console.warn('[migration] 0003_categories_indexes.js skipped under non-Postgres dialect'); return; }
    await trx.raw('DROP INDEX IF EXISTS idx_categories_store');
  },
};
