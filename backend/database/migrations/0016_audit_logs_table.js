'use strict';

const { isPostgres } = require('../dialect-helper');

/**
 * DATABASE_SCHEMA.md §8.1 + Rule AUD-1 (per-store SHA-256 hash chain) +
 * Rule AUD-3 (written in the same transaction as the audited change).
 * `device_id` has no FK — the `devices` table is out of scope (no device
 * registration flow built yet).
 */
module.exports = {
  async up(trx) {
    if (isPostgres(trx)) {
      await trx.raw(`
        CREATE TABLE audit_logs (
          id               BIGSERIAL PRIMARY KEY,
          store_id         BIGINT NOT NULL REFERENCES stores(id),
          actor_user_id    BIGINT REFERENCES app_users(id),
          approver_user_id BIGINT REFERENCES app_users(id),
          device_id        BIGINT,
          action           TEXT NOT NULL,
          entity_type      TEXT NOT NULL,
          entity_id        BIGINT,
          before_json      JSONB,
          after_json       JSONB,
          reason_code      TEXT,
          reason_text      TEXT,
          ip_address       INET,
          trace_id         TEXT,
          prev_hash        BYTEA,
          hash             BYTEA NOT NULL,
          occurred_at      TIMESTAMPTZ NOT NULL DEFAULT now()
        )
      `);
      await trx.raw(`CREATE INDEX idx_audit_store_time ON audit_logs(store_id, occurred_at DESC)`);
      await trx.raw(`CREATE INDEX idx_audit_entity ON audit_logs(entity_type, entity_id)`);
      await trx.raw(`CREATE INDEX idx_audit_action ON audit_logs(store_id, action, occurred_at DESC)`);

      await trx.raw(`
        CREATE OR REPLACE FUNCTION forbid_audit_log_mutation()
        RETURNS TRIGGER AS $$
        BEGIN
          RAISE EXCEPTION 'audit_logs is append-only: % is not permitted (id=%)', TG_OP, OLD.id;
        END;
        $$ LANGUAGE plpgsql;
      `);
      await trx.raw(`
        CREATE TRIGGER trg_audit_logs_append_only
        BEFORE UPDATE OR DELETE ON audit_logs
        FOR EACH ROW EXECUTE FUNCTION forbid_audit_log_mutation();
      `);
      return;
    }

    await trx.raw(`
      CREATE TABLE audit_logs (
        id               INTEGER PRIMARY KEY AUTOINCREMENT,
        store_id         INTEGER NOT NULL REFERENCES stores(id),
        actor_user_id    INTEGER REFERENCES app_users(id),
        approver_user_id INTEGER REFERENCES app_users(id),
        device_id        INTEGER,
        action           TEXT NOT NULL,
        entity_type      TEXT NOT NULL,
        entity_id        INTEGER,
        before_json      TEXT,
        after_json       TEXT,
        reason_code      TEXT,
        reason_text      TEXT,
        ip_address       TEXT,
        trace_id         TEXT,
        prev_hash        BLOB,
        hash             BLOB NOT NULL,
        occurred_at      TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `);
    await trx.raw(`CREATE INDEX idx_audit_store_time ON audit_logs(store_id, occurred_at DESC)`);
    await trx.raw(`CREATE INDEX idx_audit_entity ON audit_logs(entity_type, entity_id)`);
    await trx.raw(`CREATE INDEX idx_audit_action ON audit_logs(store_id, action, occurred_at DESC)`);
    await trx.raw(`
      CREATE TRIGGER trg_audit_logs_no_update BEFORE UPDATE ON audit_logs
      BEGIN SELECT RAISE(ABORT, 'audit_logs is append-only'); END
    `);
    await trx.raw(`
      CREATE TRIGGER trg_audit_logs_no_delete BEFORE DELETE ON audit_logs
      BEGIN SELECT RAISE(ABORT, 'audit_logs is append-only'); END
    `);
  },
  async down(trx) {
    if (!isPostgres(trx)) {
      await trx.raw('DROP TABLE IF EXISTS audit_logs');
      return;
    }
    await trx.raw('DROP TRIGGER IF EXISTS trg_audit_logs_append_only ON audit_logs');
    await trx.raw('DROP FUNCTION IF EXISTS forbid_audit_log_mutation()');
    await trx.raw('DROP TABLE IF EXISTS audit_logs');
  },
};
