'use strict';

const { isPostgres } = require('../dialect-helper');

/** DATABASE_SCHEMA.md §7.2. */
module.exports = {
  async up(trx) {
    if (!isPostgres(trx)) { console.warn('[migration] 0021_purchase_orders_constraints.js skipped under non-Postgres dialect'); return; }
    await trx.raw(`ALTER TABLE purchase_orders ADD CONSTRAINT uq_po_no UNIQUE (store_id, po_no)`);

    await trx.raw(`ALTER TABLE purchase_order_items ALTER COLUMN ordered_qty TYPE numeric(18,4) USING ordered_qty::numeric(18,4)`);
    await trx.raw(`ALTER TABLE purchase_order_items ALTER COLUMN conversion_factor TYPE numeric(18,6) USING conversion_factor::numeric(18,6)`);
    await trx.raw(`ALTER TABLE purchase_order_items ALTER COLUMN ordered_qty_base TYPE numeric(18,4) USING ordered_qty_base::numeric(18,4)`);
    await trx.raw(`ALTER TABLE purchase_order_items ALTER COLUMN received_qty_base TYPE numeric(18,4) USING received_qty_base::numeric(18,4)`);
  },
  async down(trx) {
    if (!isPostgres(trx)) { console.warn('[migration] 0021_purchase_orders_constraints.js skipped under non-Postgres dialect'); return; }
    await trx.raw('ALTER TABLE purchase_orders DROP CONSTRAINT IF EXISTS uq_po_no');
  },
};
