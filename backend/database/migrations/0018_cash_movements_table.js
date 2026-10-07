'use strict';

const { isPostgres } = require('../dialect-helper');

/**
 * DATABASE_SCHEMA.md §5.2. Custom table (like stock_movements/audit_logs) —
 * a shift's cash-in/out trail is an audit record, so it's append-only
 * (corrections are new movements, never edits, mirroring Rule MOV-1).
 *
 * SQLite branch includes OWNER_DRAW/FLOAT_ADD directly in the CHECK
 * constraint from the start (they're added to the Postgres table later by
 * 0019_cash_movement_reason_codes.js's ALTER — SQLite doesn't support
 * altering a CHECK constraint in place, and that migration is a no-op under
 * SQLite anyway since this table's constraint is already complete).
 */
module.exports = {
  async up(trx) {
    if (isPostgres(trx)) {
      await trx.raw(`
        CREATE TABLE cash_movements (
          id            BIGSERIAL PRIMARY KEY,
          store_id      BIGINT NOT NULL REFERENCES stores(id),
          shift_id      BIGINT NOT NULL REFERENCES shifts(id),
          direction     TEXT NOT NULL CHECK (direction IN ('IN','OUT')),
          amount_paise  BIGINT NOT NULL CHECK (amount_paise > 0),
          reason_code   TEXT NOT NULL CHECK (reason_code IN
                        ('FLOAT_TOPUP','BANK_DROP','PETTY_EXPENSE','SUPPLIER_PAYMENT','REFUND','OTHER')),
          note          TEXT,
          created_by_id BIGINT REFERENCES app_users(id),
          approved_by_id BIGINT REFERENCES app_users(id),
          occurred_at   TIMESTAMPTZ NOT NULL DEFAULT now()
        )
      `);
      await trx.raw(`CREATE INDEX idx_cashmov_shift ON cash_movements(shift_id)`);

      await trx.raw(`
        CREATE OR REPLACE FUNCTION forbid_cash_movement_mutation()
        RETURNS TRIGGER AS $$
        BEGIN
          RAISE EXCEPTION 'cash_movements is append-only: % is not permitted (id=%)', TG_OP, OLD.id;
        END;
        $$ LANGUAGE plpgsql;
      `);
      await trx.raw(`
        CREATE TRIGGER trg_cash_movements_append_only
        BEFORE UPDATE OR DELETE ON cash_movements
        FOR EACH ROW EXECUTE FUNCTION forbid_cash_movement_mutation();
      `);
      return;
    }

    await trx.raw(`
      CREATE TABLE cash_movements (
        id            INTEGER PRIMARY KEY AUTOINCREMENT,
        store_id      INTEGER NOT NULL REFERENCES stores(id),
        shift_id      INTEGER NOT NULL REFERENCES shifts(id),
        direction     TEXT NOT NULL CHECK (direction IN ('IN','OUT')),
        amount_paise  INTEGER NOT NULL CHECK (amount_paise > 0),
        reason_code   TEXT NOT NULL CHECK (reason_code IN
                      ('FLOAT_TOPUP','FLOAT_ADD','BANK_DROP','PETTY_EXPENSE','SUPPLIER_PAYMENT','OWNER_DRAW','REFUND','OTHER')),
        note          TEXT,
        created_by_id INTEGER REFERENCES app_users(id),
        approved_by_id INTEGER REFERENCES app_users(id),
        occurred_at   TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `);
    await trx.raw(`CREATE INDEX idx_cashmov_shift ON cash_movements(shift_id)`);
    await trx.raw(`
      CREATE TRIGGER trg_cash_movements_no_update BEFORE UPDATE ON cash_movements
      BEGIN SELECT RAISE(ABORT, 'cash_movements is append-only'); END
    `);
    await trx.raw(`
      CREATE TRIGGER trg_cash_movements_no_delete BEFORE DELETE ON cash_movements
      BEGIN SELECT RAISE(ABORT, 'cash_movements is append-only'); END
    `);
  },
  async down(trx) {
    if (!isPostgres(trx)) {
      await trx.raw('DROP TABLE IF EXISTS cash_movements');
      return;
    }
    await trx.raw('DROP TRIGGER IF EXISTS trg_cash_movements_append_only ON cash_movements');
    await trx.raw('DROP FUNCTION IF EXISTS forbid_cash_movement_mutation()');
    await trx.raw('DROP TABLE IF EXISTS cash_movements');
  },
};
