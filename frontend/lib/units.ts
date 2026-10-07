import Decimal from 'decimal.js';
import type { BaseUnit, Product, ProductSnapshot, UnitCode, UnitConversion } from '@/types/pos';

/**
 * REQUIREMENTS.md §1 — Unit Conversion Engine. Ported near-verbatim from the
 * TS pseudocode in §1.3, with the precision guard from Rule UC-5.
 */

export class PosError extends Error {
  code: string;
  constructor(code: string, message?: string) {
    super(message ?? code);
    this.code = code;
    this.name = 'PosError';
  }
}

export function findConversion(
  conversions: UnitConversion[],
  unit: UnitCode
): UnitConversion {
  const row = conversions.find((c) => c.unit_code === unit);
  if (!row) throw new PosError('ERR_UNIT_NOT_CONVERTIBLE', `Unit ${unit} is not convertible for this product`);
  return row;
}

/** entered -> base. Rule UC-5: base result rounded to 4dp, half-up. */
export function toBase(enteredQty: Decimal.Value, unit: UnitCode, conversions: UnitConversion[]): Decimal {
  const row = findConversion(conversions, unit);
  return new Decimal(enteredQty).mul(row.factor_to_base).toDecimalPlaces(4, Decimal.ROUND_HALF_UP);
}

/** base -> display (largest sensible unit). REQUIREMENTS.md §1.3 / Rule UC-4. */
export function fromBase(baseQty: Decimal.Value, baseUnit: BaseUnit): { qty: Decimal; unit: UnitCode } {
  const qty = new Decimal(baseQty);
  if (baseUnit === 'G' && qty.gte(1000)) return { qty: qty.div(1000), unit: 'KG' };
  if (baseUnit === 'ML' && qty.gte(1000)) return { qty: qty.div(1000), unit: 'L' };
  return { qty, unit: baseUnit };
}

export function formatQty(qty: Decimal.Value, unit: UnitCode): string {
  const d = new Decimal(qty);
  const s = d.toDecimalPlaces(3).toString();
  return `${s} ${unit.toLowerCase()}`;
}

/** Rule UC-5 + PCS fractional rule (REQUIREMENTS.md §0.2). Throws PosError on violation. */
export function validateEnteredQty(
  snapshot: Pick<ProductSnapshot, 'base_unit' | 'allow_fractional' | 'quantity_precision'>,
  enteredQty: Decimal.Value
): void {
  const d = new Decimal(enteredQty);
  if (d.isNaN() || d.lte(0)) {
    throw new PosError('ERR_QTY_INVALID', 'Quantity must be greater than zero');
  }
  if (d.decimalPlaces() > snapshot.quantity_precision) {
    throw new PosError(
      'ERR_QTY_INVALID',
      `Quantity has more decimals than allowed (max ${snapshot.quantity_precision})`
    );
  }
  if (snapshot.base_unit === 'PCS' && !snapshot.allow_fractional && !d.isInteger()) {
    throw new PosError('ERR_FRACTIONAL_NOT_ALLOWED', 'This product cannot be sold in fractional pieces');
  }
}

/** Convenience: builds the immutable product_snapshot stored on a CartLine at add-time. */
export function toProductSnapshot(product: Product): ProductSnapshot {
  return {
    name: product.name,
    name_local: product.name_local,
    base_unit: product.base_unit,
    hsn_code: product.hsn_code,
    gst_rate: product.gst_rate,
    tax_inclusive: product.tax_inclusive,
    discount_exempt: product.discount_exempt,
    pricing_unit: product.pricing_unit,
    quantity_precision: product.quantity_precision,
    allow_fractional: product.allow_fractional,
    mrp_paise: product.mrp_paise,
    unit_conversions: product.unit_conversions,
  };
}

/** Fractional quantity chips for the Quick Grid, in each base unit's canonical display unit. */
export function quickGridChips(baseUnit: BaseUnit): { label: string; enteredQty: string; unit: UnitCode }[] {
  switch (baseUnit) {
    case 'G':
      return [
        { label: '100g', enteredQty: '100', unit: 'G' },
        { label: '250g', enteredQty: '250', unit: 'G' },
        { label: '500g', enteredQty: '500', unit: 'G' },
        { label: '1kg', enteredQty: '1', unit: 'KG' },
      ];
    case 'ML':
      return [
        { label: '100ml', enteredQty: '100', unit: 'ML' },
        { label: '250ml', enteredQty: '250', unit: 'ML' },
        { label: '500ml', enteredQty: '500', unit: 'ML' },
        { label: '1L', enteredQty: '1', unit: 'L' },
      ];
    case 'PCS':
      return [
        { label: '1', enteredQty: '1', unit: 'PCS' },
        { label: '2', enteredQty: '2', unit: 'PCS' },
        { label: '5', enteredQty: '5', unit: 'PCS' },
        { label: '10', enteredQty: '10', unit: 'PCS' },
      ];
  }
}
