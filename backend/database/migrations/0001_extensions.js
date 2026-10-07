'use strict';

const { isPostgres } = require('../dialect-helper');

/**
 * DATABASE_SCHEMA.md conventions note pg_trgm as a required extension
 * (idx_products_search_trgm, idx_customers_name_trgm). Enabled once, globally.
 */
module.exports = {
  async up(trx) {
    if (!isPostgres(trx)) { console.warn('[migration] 0001_extensions.js skipped under non-Postgres dialect'); return; }
    await trx.raw('CREATE EXTENSION IF NOT EXISTS pg_trgm');
  },
  async down() {
    // Extensions are shared cluster-wide state; never dropped by a down migration.
  },
};
