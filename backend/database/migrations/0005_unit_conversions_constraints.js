'use strict';

const { isPostgres } = require('../dialect-helper');

/**
 * DATABASE_SCHEMA.md §3.4 + REQUIREMENTS.md §1.2 (Rules UC-1, UC-2, UC-3).
 *
 * Invariant UC-A ("every product has exactly one row where factor_to_base = 1
 * and unit_code = product.base_unit") is split across two layers:
 *  - the base row is *created* by product.ts's afterCreate lifecycle (Rule UC-2:
 *    "seeded automatically on product create"), which this migration cannot do;
 *  - this migration adds the trigger that *guards* the invariant afterwards —
 *    it blocks deleting the base row, or changing its factor away from 1.
 */
module.exports = {
  async up(trx) {
    if (!isPostgres(trx)) { console.warn('[migration] 0005_unit_conversions_constraints.js skipped under non-Postgres dialect'); return; }
    await trx.raw(`ALTER TABLE unit_conversions ALTER COLUMN factor_to_base TYPE numeric(18,6) USING factor_to_base::numeric(18,6)`);

    await trx.raw(`
      ALTER TABLE unit_conversions
        ADD CONSTRAINT ck_uc_unit_code CHECK (unit_code IN
          ('G','KG','QUINTAL','ML','L','PCS','DOZEN','PACKET','CARTON','BORI','CRATE'))
    `);
    await trx.raw(`ALTER TABLE unit_conversions ADD CONSTRAINT ck_uc_factor_positive CHECK (factor_to_base > 0)`);
    await trx.raw(`ALTER TABLE unit_conversions ADD CONSTRAINT uq_unit_per_product UNIQUE (product_id, unit_code)`);
    await trx.raw(`CREATE INDEX idx_uc_product ON unit_conversions(product_id)`);

    await trx.raw(`
      CREATE OR REPLACE FUNCTION enforce_unit_conversion_base_invariant()
      RETURNS TRIGGER AS $$
      DECLARE
        v_base_unit TEXT;
      BEGIN
        IF TG_OP = 'DELETE' THEN
          SELECT base_unit INTO v_base_unit FROM products WHERE id = OLD.product_id;
          IF OLD.unit_code = v_base_unit THEN
            RAISE EXCEPTION 'UC_A_VIOLATION: cannot delete the base-unit conversion row for product %', OLD.product_id;
          END IF;
          RETURN OLD;
        END IF;

        SELECT base_unit INTO v_base_unit FROM products WHERE id = NEW.product_id;
        IF NEW.unit_code = v_base_unit AND NEW.factor_to_base <> 1 THEN
          RAISE EXCEPTION 'UC_A_VIOLATION: the base-unit conversion row for product % must keep factor_to_base = 1', NEW.product_id;
        END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql;
    `);
    await trx.raw(`
      CREATE TRIGGER trg_unit_conversion_base_invariant
      BEFORE INSERT OR UPDATE OR DELETE ON unit_conversions
      FOR EACH ROW EXECUTE FUNCTION enforce_unit_conversion_base_invariant();
    `);
  },
  async down(trx) {
    if (!isPostgres(trx)) { console.warn('[migration] 0005_unit_conversions_constraints.js skipped under non-Postgres dialect'); return; }
    await trx.raw('DROP TRIGGER IF EXISTS trg_unit_conversion_base_invariant ON unit_conversions');
    await trx.raw('DROP FUNCTION IF EXISTS enforce_unit_conversion_base_invariant()');
    await trx.raw('DROP INDEX IF EXISTS idx_uc_product');
    await trx.raw('ALTER TABLE unit_conversions DROP CONSTRAINT IF EXISTS uq_unit_per_product');
    await trx.raw('ALTER TABLE unit_conversions DROP CONSTRAINT IF EXISTS ck_uc_factor_positive');
    await trx.raw('ALTER TABLE unit_conversions DROP CONSTRAINT IF EXISTS ck_uc_unit_code');
  },
};
