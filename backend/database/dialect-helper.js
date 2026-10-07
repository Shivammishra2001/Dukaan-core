'use strict';

/**
 * These migrations contain Postgres-only DDL (extensions, JSONB/BYTEA/TIMESTAMPTZ
 * columns, plpgsql triggers, partial indexes) per DATABASE_SCHEMA.md. Under a
 * non-Postgres dialect (e.g. local SQLite dev without Postgres credentials) they
 * are skipped rather than rewritten, so Strapi can still boot for UI/page-load
 * sanity checks — but the custom financial tables they'd create (ledger,
 * stock_movements, idempotency_keys, etc.) will NOT exist, so checkout/ledger
 * write-paths will fail against SQLite. Real functional testing requires Postgres.
 */
function isPostgres(trx) {
  return trx.client.dialect === 'postgresql';
}

module.exports = { isPostgres };
