'use strict';

const { isPostgres } = require('../dialect-helper');

/**
 * DATABASE_SCHEMA.md §4.2 + Rule MOV-1 ("append-only. Corrections are new
 * movements, never updates or deletes"). Custom table per §9.1.
 */
module.exports = {
  async up(trx) {
    if (isPostgres(trx)) {
      await trx.raw(`
        CREATE TABLE stock_movements (
          id              BIGSERIAL PRIMARY KEY,
          store_id        BIGINT NOT NULL REFERENCES stores(id),
          product_id      BIGINT NOT NULL REFERENCES products(id),
          batch_id        BIGINT NOT NULL REFERENCES inventory_batches(id),
          movement_type   TEXT NOT NULL CHECK (movement_type IN
              ('OPENING','PURCHASE_IN','PURCHASE_RETURN','SALE','SALE_RETURN',
               'ADJUSTMENT_IN','ADJUSTMENT_OUT','WRITE_OFF_EXPIRY','TRANSFER_IN','TRANSFER_OUT')),
          qty_base        NUMERIC(18,4) NOT NULL,
          balance_after   NUMERIC(18,4) NOT NULL,
          unit_cost_paise BIGINT,
          reference_type  TEXT NOT NULL CHECK (reference_type IN
              ('ORDER','ORDER_ITEM','PURCHASE_BILL','ADJUSTMENT','TRANSFER','SYSTEM')),
          reference_id    BIGINT,
          reason_code     TEXT,
          note            TEXT,
          created_by_id   BIGINT REFERENCES app_users(id),
          occurred_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
          created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
        )
      `);
      await trx.raw(`CREATE INDEX idx_movements_batch ON stock_movements(batch_id, id)`);
      await trx.raw(`CREATE INDEX idx_movements_product ON stock_movements(store_id, product_id, occurred_at DESC)`);
      await trx.raw(`CREATE INDEX idx_movements_ref ON stock_movements(reference_type, reference_id)`);

      await trx.raw(`
        CREATE OR REPLACE FUNCTION forbid_stock_movement_mutation()
        RETURNS TRIGGER AS $$
        BEGIN
          RAISE EXCEPTION 'stock_movements is append-only: % is not permitted (id=%)', TG_OP, OLD.id;
        END;
        $$ LANGUAGE plpgsql;
      `);
      await trx.raw(`
        CREATE TRIGGER trg_stock_movements_append_only
        BEFORE UPDATE OR DELETE ON stock_movements
        FOR EACH ROW EXECUTE FUNCTION forbid_stock_movement_mutation();
      `);
      return;
    }

    await trx.raw(`
      CREATE TABLE stock_movements (
        id              INTEGER PRIMARY KEY AUTOINCREMENT,
        store_id        INTEGER NOT NULL REFERENCES stores(id),
        product_id      INTEGER NOT NULL REFERENCES products(id),
        batch_id        INTEGER NOT NULL REFERENCES inventory_batches(id),
        movement_type   TEXT NOT NULL CHECK (movement_type IN
            ('OPENING','PURCHASE_IN','PURCHASE_RETURN','SALE','SALE_RETURN',
             'ADJUSTMENT_IN','ADJUSTMENT_OUT','WRITE_OFF_EXPIRY','TRANSFER_IN','TRANSFER_OUT')),
        qty_base        NUMERIC NOT NULL,
        balance_after   NUMERIC NOT NULL,
        unit_cost_paise INTEGER,
        reference_type  TEXT NOT NULL CHECK (reference_type IN
            ('ORDER','ORDER_ITEM','PURCHASE_BILL','ADJUSTMENT','TRANSFER','SYSTEM')),
        reference_id    INTEGER,
        reason_code     TEXT,
        note            TEXT,
        created_by_id   INTEGER REFERENCES app_users(id),
        occurred_at     TEXT NOT NULL DEFAULT (datetime('now')),
        created_at      TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `);
    await trx.raw(`CREATE INDEX idx_movements_batch ON stock_movements(batch_id, id)`);
    await trx.raw(`CREATE INDEX idx_movements_product ON stock_movements(store_id, product_id, occurred_at DESC)`);
    await trx.raw(`CREATE INDEX idx_movements_ref ON stock_movements(reference_type, reference_id)`);
    await trx.raw(`
      CREATE TRIGGER trg_stock_movements_no_update BEFORE UPDATE ON stock_movements
      BEGIN SELECT RAISE(ABORT, 'stock_movements is append-only'); END
    `);
    await trx.raw(`
      CREATE TRIGGER trg_stock_movements_no_delete BEFORE DELETE ON stock_movements
      BEGIN SELECT RAISE(ABORT, 'stock_movements is append-only'); END
    `);
  },
  async down(trx) {
    if (!isPostgres(trx)) {
      await trx.raw('DROP TABLE IF EXISTS stock_movements');
      return;
    }
    await trx.raw('DROP TRIGGER IF EXISTS trg_stock_movements_append_only ON stock_movements');
    await trx.raw('DROP FUNCTION IF EXISTS forbid_stock_movement_mutation()');
    await trx.raw('DROP TABLE IF EXISTS stock_movements');
  },
};
