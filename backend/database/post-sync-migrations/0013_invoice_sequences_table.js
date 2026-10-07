'use strict';

const { isPostgres } = require('../dialect-helper');

/**
 * DATABASE_SCHEMA.md §5.6 + SYSTEM_ARCHITECTURE.md §4.4. Custom table, not
 * a content type (§9.1 pattern) — a PostgreSQL SEQUENCE is deliberately
 * *not* used (ADR-06): sequences aren't transactional and leave gaps on
 * rollback, but this table's increment lives inside the order-insert
 * transaction, so a rollback also rolls back the number.
 */
module.exports = {
  async up(trx) {
    if (isPostgres(trx)) {
      await trx.raw(`
        CREATE TABLE invoice_sequences (
          store_id       BIGINT NOT NULL REFERENCES stores(id),
          counter_id     BIGINT NOT NULL REFERENCES counters(id),
          financial_year VARCHAR(7) NOT NULL,
          doc_type       TEXT NOT NULL DEFAULT 'SALE' CHECK (doc_type IN ('SALE','RETURN','PURCHASE','ADJUSTMENT')),
          last_value     BIGINT NOT NULL DEFAULT 0,
          PRIMARY KEY (store_id, counter_id, financial_year, doc_type)
        )
      `);
      return;
    }

    await trx.raw(`
      CREATE TABLE invoice_sequences (
        store_id       INTEGER NOT NULL REFERENCES stores(id),
        counter_id     INTEGER NOT NULL REFERENCES counters(id),
        financial_year TEXT NOT NULL,
        doc_type       TEXT NOT NULL DEFAULT 'SALE' CHECK (doc_type IN ('SALE','RETURN','PURCHASE','ADJUSTMENT')),
        last_value     INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (store_id, counter_id, financial_year, doc_type)
      )
    `);
  },
  async down(trx) {
    await trx.raw('DROP TABLE IF EXISTS invoice_sequences');
  },
};
