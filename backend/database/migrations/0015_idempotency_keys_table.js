'use strict';

const { isPostgres } = require('../dialect-helper');

/**
 * DATABASE_SCHEMA.md §8.2 + SYSTEM_ARCHITECTURE.md §3.4 / API_CONTRACTS.md
 * §2.4 step 1. Custom table — checkout.service reads/writes it directly via
 * Knex inside the same transaction as the order insert.
 *
 * SQLite branch: checkout.ts's raw `INSERT ... ON CONFLICT ... DO NOTHING
 * ... RETURNING key` is left completely unchanged — better-sqlite3's bundled
 * SQLite (3.35+) supports both UPSERT and RETURNING natively, so that query
 * works verbatim against either dialect. Only the column types differ here.
 */
module.exports = {
  async up(trx) {
    if (isPostgres(trx)) {
      await trx.raw(`
        CREATE TABLE idempotency_keys (
          key            UUID NOT NULL,
          store_id       BIGINT NOT NULL REFERENCES stores(id),
          route          TEXT NOT NULL,
          request_hash   BYTEA NOT NULL,
          status         TEXT NOT NULL CHECK (status IN ('IN_PROGRESS','COMPLETED','FAILED')),
          response_json  JSONB,
          http_status    SMALLINT,
          created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
          completed_at   TIMESTAMPTZ,
          expires_at     TIMESTAMPTZ NOT NULL DEFAULT (now() + interval '30 days'),
          PRIMARY KEY (store_id, key)
        )
      `);
      await trx.raw(`CREATE INDEX idx_idem_expiry ON idempotency_keys(expires_at)`);
      return;
    }

    await trx.raw(`
      CREATE TABLE idempotency_keys (
        key            TEXT NOT NULL,
        store_id       INTEGER NOT NULL REFERENCES stores(id),
        route          TEXT NOT NULL,
        request_hash   BLOB NOT NULL,
        status         TEXT NOT NULL CHECK (status IN ('IN_PROGRESS','COMPLETED','FAILED')),
        response_json  TEXT,
        http_status    INTEGER,
        created_at     TEXT NOT NULL DEFAULT (datetime('now')),
        completed_at   TEXT,
        expires_at     TEXT NOT NULL DEFAULT (datetime('now', '+30 days')),
        PRIMARY KEY (store_id, key)
      )
    `);
    await trx.raw(`CREATE INDEX idx_idem_expiry ON idempotency_keys(expires_at)`);
  },
  async down(trx) {
    await trx.raw('DROP TABLE IF EXISTS idempotency_keys');
  },
};
