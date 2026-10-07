import type { Knex } from 'knex';

/**
 * For raw-SQL fragments that differ between Postgres (production) and
 * SQLite (temporary local dev/testing path — no Postgres credentials
 * available). Knex-builder methods like `.forUpdate()` and `.fn.now()`
 * already handle this themselves; these helpers are only needed at the
 * handful of `trx.raw(...)` call sites that couldn't be expressed through
 * the query builder (multi-clause conditional UPDATEs, sequence upserts).
 */
export function isPostgres(trx: Knex.Transaction): boolean {
  return trx.client.dialect === 'postgresql';
}

/** `now()` on Postgres, `datetime('now')` on SQLite. */
export function nowSql(trx: Knex.Transaction): string {
  return isPostgres(trx) ? 'now()' : "datetime('now')";
}

/**
 * `FOR UPDATE` row-lock clause on Postgres, empty string on SQLite (which
 * has no row-level locking — fine for the single-connection sequential
 * dev/test path this exists for; production always runs Postgres, where
 * the lock is real).
 */
export function forUpdateSql(trx: Knex.Transaction): string {
  return isPostgres(trx) ? 'FOR UPDATE' : '';
}

/**
 * `trx.raw(...)` on Postgres (node-pg) returns `{ rows: [...] }`; on SQLite
 * (better-sqlite3) Knex returns the row array directly. Every raw() call
 * site that reads results back needs this normalization to work under both.
 */
export function rawRows<T = Record<string, unknown>>(result: unknown, trx: Knex.Transaction): T[] {
  return (isPostgres(trx) ? (result as { rows: T[] }).rows : (result as T[])) ?? [];
}
