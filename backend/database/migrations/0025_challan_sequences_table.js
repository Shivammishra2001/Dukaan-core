'use strict';

const { isPostgres } = require('../dialect-helper');

/**
 * Milestone 6: gapless Delivery Challan numbering (`CHAL-2026-000123`),
 * same in-transaction-increment pattern as invoice_sequences (§5.6,
 * ADR-06) — a separate table rather than overloading invoice_sequences,
 * since that table's `doc_type` CHECK constraint doesn't include a challan
 * type and challans aren't keyed by counter_id the way invoices are.
 */
module.exports = {
  async up(trx) {
    if (isPostgres(trx)) {
      await trx.raw(`
        CREATE TABLE challan_sequences (
          store_id       BIGINT NOT NULL REFERENCES stores(id),
          financial_year VARCHAR(7) NOT NULL,
          last_value     BIGINT NOT NULL DEFAULT 0,
          PRIMARY KEY (store_id, financial_year)
        )
      `);
      return;
    }

    await trx.raw(`
      CREATE TABLE challan_sequences (
        store_id       INTEGER NOT NULL REFERENCES stores(id),
        financial_year TEXT NOT NULL,
        last_value     INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (store_id, financial_year)
      )
    `);
  },
  async down(trx) {
    await trx.raw('DROP TABLE IF EXISTS challan_sequences');
  },
};
