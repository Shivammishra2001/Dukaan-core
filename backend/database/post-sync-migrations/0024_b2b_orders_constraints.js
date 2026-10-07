'use strict';

const { isPostgres } = require('../dialect-helper');

/** Milestone 6 addition — see b2b-order/content-types/b2b-order/schema.json. */
module.exports = {
  async up(trx) {
    if (!isPostgres(trx)) { console.warn('[migration] 0024_b2b_orders_constraints.js skipped under non-Postgres dialect'); return; }
    await trx.raw(`ALTER TABLE b2b_orders ADD CONSTRAINT uq_b2b_order_client_uuid UNIQUE (store_id, client_uuid)`);
    await trx.raw(`ALTER TABLE b2b_orders ADD CONSTRAINT uq_b2b_challan_no UNIQUE (store_id, challan_no)`);
    await trx.raw(`CREATE INDEX idx_b2b_orders_store_status ON b2b_orders(store_id, status, business_date DESC)`);
    await trx.raw(`CREATE INDEX idx_b2b_orders_route ON b2b_orders(store_id, route) WHERE status = 'BOOKED'`);

    await trx.raw(`ALTER TABLE b2b_order_items ALTER COLUMN entered_qty TYPE numeric(18,4) USING entered_qty::numeric(18,4)`);
    await trx.raw(`ALTER TABLE b2b_order_items ALTER COLUMN conversion_factor TYPE numeric(18,6) USING conversion_factor::numeric(18,6)`);
    await trx.raw(`ALTER TABLE b2b_order_items ALTER COLUMN qty_base TYPE numeric(18,4) USING qty_base::numeric(18,4)`);
    await trx.raw(`ALTER TABLE b2b_order_items ALTER COLUMN gst_rate TYPE numeric(5,2) USING gst_rate::numeric(5,2)`);
    await trx.raw(`CREATE INDEX idx_b2b_order_items_order ON b2b_order_items(b_2_b_order_id)`);
  },
  async down(trx) {
    if (!isPostgres(trx)) { console.warn('[migration] 0024_b2b_orders_constraints.js skipped under non-Postgres dialect'); return; }
    await trx.raw('DROP INDEX IF EXISTS idx_b2b_order_items_order');
    await trx.raw('DROP INDEX IF EXISTS idx_b2b_orders_route');
    await trx.raw('DROP INDEX IF EXISTS idx_b2b_orders_store_status');
    await trx.raw('ALTER TABLE b2b_orders DROP CONSTRAINT IF EXISTS uq_b2b_challan_no');
    await trx.raw('ALTER TABLE b2b_orders DROP CONSTRAINT IF EXISTS uq_b2b_order_client_uuid');
  },
};
