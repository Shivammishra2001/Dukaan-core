'use strict';

const { isPostgres } = require('../dialect-helper');

/**
 * DATABASE_SCHEMA.md §3.2. Strapi's `decimal` attribute always maps to
 * DECIMAL(10,2) (see @strapi/database schema builder) — the exact precisions
 * from the spec are applied here. CHECK constraints replace the native
 * Postgres enum type per the file's stated convention: "Enumerations are
 * PostgreSQL TEXT with CHECK constraints (not native enums)".
 */
module.exports = {
  async up(trx) {
    if (!isPostgres(trx)) { console.warn('[migration] 0004_products_constraints.js skipped under non-Postgres dialect'); return; }
    await trx.raw(`ALTER TABLE products ALTER COLUMN gst_rate TYPE numeric(5,2) USING gst_rate::numeric(5,2)`);
    await trx.raw(`ALTER TABLE products ALTER COLUMN cess_rate TYPE numeric(5,2) USING cess_rate::numeric(5,2)`);
    await trx.raw(`ALTER TABLE products ALTER COLUMN reorder_level_base TYPE numeric(18,4) USING reorder_level_base::numeric(18,4)`);
    await trx.raw(`ALTER TABLE products ALTER COLUMN reorder_qty_base TYPE numeric(18,4) USING reorder_qty_base::numeric(18,4)`);

    await trx.raw(`ALTER TABLE products ADD CONSTRAINT uq_product_sku UNIQUE (store_id, sku)`);

    await trx.raw(`ALTER TABLE products ADD CONSTRAINT ck_products_base_unit CHECK (base_unit IN ('G','ML','PCS'))`);
    await trx.raw(`ALTER TABLE products ADD CONSTRAINT ck_products_quantity_precision CHECK (quantity_precision BETWEEN 0 AND 3)`);
    await trx.raw(`ALTER TABLE products ADD CONSTRAINT ck_products_mrp_nonneg CHECK (mrp_paise IS NULL OR mrp_paise >= 0)`);
    await trx.raw(`ALTER TABLE products ADD CONSTRAINT ck_products_sell_rate_nonneg CHECK (sell_rate_paise >= 0)`);
    await trx.raw(`ALTER TABLE products ADD CONSTRAINT ck_products_gst_rate CHECK (gst_rate >= 0 AND gst_rate <= 50)`);

    await trx.raw(`CREATE INDEX idx_products_store_active ON products(store_id) WHERE is_active`);
    await trx.raw(`CREATE INDEX idx_products_category ON products(store_id, category_id, sales_rank DESC)`);
    await trx.raw(`CREATE INDEX idx_products_updated ON products(store_id, updated_at, id)`);
    await trx.raw(`CREATE INDEX idx_products_search_trgm ON products USING gin (search_text gin_trgm_ops)`);
  },
  async down(trx) {
    if (!isPostgres(trx)) { console.warn('[migration] 0004_products_constraints.js skipped under non-Postgres dialect'); return; }
    await trx.raw('DROP INDEX IF EXISTS idx_products_search_trgm');
    await trx.raw('DROP INDEX IF EXISTS idx_products_updated');
    await trx.raw('DROP INDEX IF EXISTS idx_products_category');
    await trx.raw('DROP INDEX IF EXISTS idx_products_store_active');
    await trx.raw('ALTER TABLE products DROP CONSTRAINT IF EXISTS ck_products_gst_rate');
    await trx.raw('ALTER TABLE products DROP CONSTRAINT IF EXISTS ck_products_sell_rate_nonneg');
    await trx.raw('ALTER TABLE products DROP CONSTRAINT IF EXISTS ck_products_mrp_nonneg');
    await trx.raw('ALTER TABLE products DROP CONSTRAINT IF EXISTS ck_products_quantity_precision');
    await trx.raw('ALTER TABLE products DROP CONSTRAINT IF EXISTS ck_products_base_unit');
    await trx.raw('ALTER TABLE products DROP CONSTRAINT IF EXISTS uq_product_sku');
  },
};
