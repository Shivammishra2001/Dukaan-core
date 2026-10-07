import type { Product } from '@/types/pos';

/**
 * Builds a synthetic, throwaway Product for a one-off sale that has no
 * catalogue entry (a custom repair job, a miscellaneous charge, ...).
 * Deliberately reuses the existing addByProduct/addByBarcode cart pipeline
 * instead of adding a parallel "custom line" concept to CartLine — every
 * pricing/discount/tax rule that already works for a real product works
 * for this one unchanged.
 */
export function buildCustomProduct(description: string, amountPaise: number): Product {
  return {
    id: `custom:${crypto.randomUUID()}`,
    sku: 'CUSTOM',
    name: description.trim() || 'Custom Entry',
    category: 'Custom',
    base_unit: 'PCS',
    allow_fractional: false,
    quantity_precision: 0,
    default_sale_unit: 'PCS',
    default_purchase_unit: 'PCS',
    pricing_unit: 'PCS',
    sell_rate_paise: amountPaise,
    mrp_paise: null,
    gst_rate: 0,
    tax_inclusive: true,
    discount_exempt: false,
    unit_conversions: [{ unit_code: 'PCS', factor_to_base: 1, is_sale_unit: true, is_purchase_unit: false }],
    stock_base: Number.MAX_SAFE_INTEGER,
    is_loose: false,
  };
}
