'use strict';

const { isPostgres } = require('../dialect-helper');

/**
 * Milestone 5: the frontend Cash In/Out modal's reason dropdown adds
 * OWNER_DRAW and FLOAT_ADD (a friendlier label for the same concept as
 * FLOAT_TOPUP). Additive — the original codes from 0018 stay valid.
 */
module.exports = {
  async up(trx) {
    if (!isPostgres(trx)) { console.warn('[migration] 0019_cash_movement_reason_codes.js skipped under non-Postgres dialect'); return; }
    await trx.raw(`ALTER TABLE cash_movements DROP CONSTRAINT cash_movements_reason_code_check`);
    await trx.raw(`
      ALTER TABLE cash_movements
        ADD CONSTRAINT cash_movements_reason_code_check CHECK (reason_code IN
          ('FLOAT_TOPUP','FLOAT_ADD','BANK_DROP','PETTY_EXPENSE','SUPPLIER_PAYMENT','OWNER_DRAW','REFUND','OTHER'))
    `);
  },
  async down(trx) {
    if (!isPostgres(trx)) { console.warn('[migration] 0019_cash_movement_reason_codes.js skipped under non-Postgres dialect'); return; }
    await trx.raw(`ALTER TABLE cash_movements DROP CONSTRAINT cash_movements_reason_code_check`);
    await trx.raw(`
      ALTER TABLE cash_movements
        ADD CONSTRAINT cash_movements_reason_code_check CHECK (reason_code IN
          ('FLOAT_TOPUP','BANK_DROP','PETTY_EXPENSE','SUPPLIER_PAYMENT','REFUND','OTHER'))
    `);
  },
};
