import Decimal from 'decimal.js';
import { AppError } from './errors';

/**
 * REQUIREMENTS.md §1 — server-side authoritative port of the same engine
 * implemented client-side in frontend/lib/units.ts (Rule FE-4: client and
 * server run the same algorithm; the server recomputes and wins on
 * disagreement). No shared `packages/` workspace exists yet (Milestone 0's
 * monorepo was never scaffolded), so this is a deliberate, tracked
 * duplication rather than an oversight — keep both copies in sync.
 */

/**
 * Kept as an alias so every Milestone-3 `import { CheckoutError } from
 * '.../units'` keeps working unchanged. New code (shifts, onboarding)
 * should import `AppError` from `./errors` directly — this class was never
 * actually checkout-specific, just named that way before `errors.ts` existed.
 */
export const CheckoutError = AppError;
export type CheckoutError = AppError;

export interface UnitConversionRow {
  id: number;
  product_id: number;
  unit_code: string;
  factor_to_base: string;
  is_sale_unit: boolean;
  is_purchase_unit: boolean;
  price_override_paise: string | null;
}

export function findConversion(conversions: UnitConversionRow[], unitCode: string): UnitConversionRow {
  const row = conversions.find((c) => c.unit_code === unitCode);
  if (!row) {
    throw new CheckoutError('ERR_UNIT_NOT_CONVERTIBLE', 422, `Unit ${unitCode} is not convertible for this product`);
  }
  return row;
}

/** Rule UC-5: base result rounded to 4dp, half-up. */
export function toBase(enteredQty: Decimal.Value, unitCode: string, conversions: UnitConversionRow[]): Decimal {
  const row = findConversion(conversions, unitCode);
  return new Decimal(enteredQty).mul(row.factor_to_base).toDecimalPlaces(4, Decimal.ROUND_HALF_UP);
}

export function validateEnteredQty(
  product: { base_unit: string; allow_fractional: boolean; quantity_precision: number },
  enteredQty: Decimal.Value
): void {
  const d = new Decimal(enteredQty);
  if (d.isNaN() || d.lte(0)) {
    throw new CheckoutError('ERR_QTY_INVALID', 422, 'Quantity must be greater than zero');
  }
  if (d.decimalPlaces() > product.quantity_precision) {
    throw new CheckoutError('ERR_QTY_INVALID', 422, `Quantity has more decimals than allowed (max ${product.quantity_precision})`);
  }
  if (product.base_unit === 'PCS' && !product.allow_fractional && !d.isInteger()) {
    throw new CheckoutError('ERR_FRACTIONAL_NOT_ALLOWED', 422, 'This product cannot be sold in fractional pieces');
  }
}
