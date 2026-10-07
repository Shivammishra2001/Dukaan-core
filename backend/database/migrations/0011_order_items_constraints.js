'use strict';

const { isPostgres } = require('../dialect-helper');

/** DATABASE_SCHEMA.md §5.4. Precision fixes — see 0004_products_constraints.js for why. */
module.exports = {
  async up(trx) {
    if (!isPostgres(trx)) { console.warn('[migration] 0011_order_items_constraints.js skipped under non-Postgres dialect'); return; }
    await trx.raw(`ALTER TABLE order_items ALTER COLUMN entered_qty TYPE numeric(18,4) USING entered_qty::numeric(18,4)`);
    await trx.raw(`ALTER TABLE order_items ALTER COLUMN qty_base TYPE numeric(18,4) USING qty_base::numeric(18,4)`);
    await trx.raw(`ALTER TABLE order_items ALTER COLUMN conversion_factor TYPE numeric(18,6) USING conversion_factor::numeric(18,6)`);
    await trx.raw(`ALTER TABLE order_items ALTER COLUMN returned_qty_base TYPE numeric(18,4) USING returned_qty_base::numeric(18,4)`);
    await trx.raw(`ALTER TABLE order_items ALTER COLUMN gst_rate TYPE numeric(5,2) USING gst_rate::numeric(5,2)`);

    await trx.raw(`ALTER TABLE order_items ADD CONSTRAINT ck_order_items_qty_base_nonzero CHECK (qty_base <> 0)`);

    await trx.raw(`CREATE INDEX idx_order_items_order ON order_items(order_id, line_no)`);
    await trx.raw(`CREATE INDEX idx_order_items_product ON order_items(store_id, product_id)`);
    await trx.raw(`CREATE INDEX idx_order_items_batch ON order_items(batch_id)`);
  },
  async down(trx) {
    if (!isPostgres(trx)) { console.warn('[migration] 0011_order_items_constraints.js skipped under non-Postgres dialect'); return; }
    await trx.raw('DROP INDEX IF EXISTS idx_order_items_batch');
    await trx.raw('DROP INDEX IF EXISTS idx_order_items_product');
    await trx.raw('DROP INDEX IF EXISTS idx_order_items_order');
    await trx.raw('ALTER TABLE order_items DROP CONSTRAINT IF EXISTS ck_order_items_qty_base_nonzero');
  },
};
