'use strict';

const { isPostgres } = require('../dialect-helper');

/**
 * DATABASE_SCHEMA.md §7.4 + §9.1. Custom table, not a content type — same
 * reasoning as customer_ledger_entries (0008): no admin action should ever
 * be able to mutate financial history. Append-only, hash-free (unlike
 * audit_logs — this mirrors customer_ledger_entries, which also has no
 * hash chain, only audit_logs does).
 */
module.exports = {
  async up(trx) {
    if (isPostgres(trx)) {
      await trx.raw(`
        CREATE TABLE supplier_ledger_entries (
          id                    BIGSERIAL PRIMARY KEY,
          document_id           VARCHAR(255) UNIQUE NOT NULL,
          store_id              BIGINT NOT NULL REFERENCES stores(id),
          supplier_id           BIGINT NOT NULL REFERENCES suppliers(id),
          entry_type            TEXT NOT NULL CHECK (entry_type IN
              ('OPENING_BALANCE','PURCHASE_BILL','PAYMENT_MADE','DEBIT_NOTE','CREDIT_NOTE','ADJUSTMENT')),
          direction             TEXT NOT NULL CHECK (direction IN ('DEBIT','CREDIT')),
          amount_paise          BIGINT NOT NULL CHECK (amount_paise > 0),
          running_balance_paise BIGINT NOT NULL,
          reference_type        TEXT,
          reference_id          BIGINT,
          entry_date            DATE NOT NULL,
          note                  TEXT,
          created_by_id         BIGINT,
          created_at            TIMESTAMPTZ NOT NULL DEFAULT now()
        )
      `);
      await trx.raw(`CREATE INDEX idx_sle_supplier ON supplier_ledger_entries(supplier_id, id DESC)`);
      await trx.raw(`CREATE INDEX idx_sle_store_date ON supplier_ledger_entries(store_id, entry_date)`);
      await trx.raw(`CREATE INDEX idx_sle_ref ON supplier_ledger_entries(reference_type, reference_id)`);

      await trx.raw(`
        CREATE OR REPLACE FUNCTION forbid_supplier_ledger_mutation()
        RETURNS TRIGGER AS $$
        BEGIN
          RAISE EXCEPTION 'supplier_ledger_entries is append-only: % is not permitted (id=%)', TG_OP, OLD.id;
        END;
        $$ LANGUAGE plpgsql;
      `);
      await trx.raw(`
        CREATE TRIGGER trg_supplier_ledger_append_only
        BEFORE UPDATE OR DELETE ON supplier_ledger_entries
        FOR EACH ROW EXECUTE FUNCTION forbid_supplier_ledger_mutation();
      `);
      return;
    }

    await trx.raw(`
      CREATE TABLE supplier_ledger_entries (
        id                    INTEGER PRIMARY KEY AUTOINCREMENT,
        document_id           TEXT UNIQUE NOT NULL,
        store_id              INTEGER NOT NULL REFERENCES stores(id),
        supplier_id           INTEGER NOT NULL REFERENCES suppliers(id),
        entry_type            TEXT NOT NULL CHECK (entry_type IN
            ('OPENING_BALANCE','PURCHASE_BILL','PAYMENT_MADE','DEBIT_NOTE','CREDIT_NOTE','ADJUSTMENT')),
        direction             TEXT NOT NULL CHECK (direction IN ('DEBIT','CREDIT')),
        amount_paise          INTEGER NOT NULL CHECK (amount_paise > 0),
        running_balance_paise INTEGER NOT NULL,
        reference_type        TEXT,
        reference_id          INTEGER,
        entry_date            TEXT NOT NULL,
        note                  TEXT,
        created_by_id         INTEGER,
        created_at            TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `);
    await trx.raw(`CREATE INDEX idx_sle_supplier ON supplier_ledger_entries(supplier_id, id DESC)`);
    await trx.raw(`CREATE INDEX idx_sle_store_date ON supplier_ledger_entries(store_id, entry_date)`);
    await trx.raw(`CREATE INDEX idx_sle_ref ON supplier_ledger_entries(reference_type, reference_id)`);
    await trx.raw(`
      CREATE TRIGGER trg_sle_no_update BEFORE UPDATE ON supplier_ledger_entries
      BEGIN SELECT RAISE(ABORT, 'supplier_ledger_entries is append-only'); END
    `);
    await trx.raw(`
      CREATE TRIGGER trg_sle_no_delete BEFORE DELETE ON supplier_ledger_entries
      BEGIN SELECT RAISE(ABORT, 'supplier_ledger_entries is append-only'); END
    `);
  },
  async down(trx) {
    if (!isPostgres(trx)) {
      await trx.raw('DROP TABLE IF EXISTS supplier_ledger_entries');
      return;
    }
    await trx.raw('DROP TRIGGER IF EXISTS trg_supplier_ledger_append_only ON supplier_ledger_entries');
    await trx.raw('DROP FUNCTION IF EXISTS forbid_supplier_ledger_mutation()');
    await trx.raw('DROP TABLE IF EXISTS supplier_ledger_entries');
  },
};
