import Decimal from 'decimal.js';

Decimal.set({ rounding: Decimal.ROUND_HALF_UP });

/**
 * REQUIREMENTS.md §2 — the authoritative server-side copy of the pricing
 * pipeline (frontend/lib/pricing.ts is the client preview; this is the
 * version that wins per Rule FE-4 / ADR-08). Verified by hand against the
 * §2.8 worked example (₹254.00 total, 14.67/14.68 CGST/SGST, -₹0.13
 * round-off) when the client copy was written — see that file's header.
 */

export function roundPaise(value: Decimal.Value): number {
  return new Decimal(value).toDecimalPlaces(0, Decimal.ROUND_HALF_UP).toNumber();
}

export interface PricingLine {
  line_group_id: string;
  gross_paise: number;
  discount_exempt: boolean;
  line_discount: { type: 'FLAT' | 'PCT'; value: number } | null;
  gst_rate: number;
  tax_inclusive: boolean;
}

export interface PricingLineResult {
  line_group_id: string;
  gross_paise: number;
  line_discount_paise: number;
  after_line_discount_paise: number;
  cart_discount_share_paise: number;
  pre_tax_paise: number;
  taxable_value_paise: number;
  tax_amount_paise: number;
  cgst_paise: number;
  sgst_paise: number;
  igst_paise: number;
  line_total_paise: number;
}

export interface GstSlabSummary {
  rate: number;
  taxable_paise: number;
  cgst_paise: number;
  sgst_paise: number;
  igst_paise: number;
}

export interface InvoiceTotals {
  lines: PricingLineResult[];
  gross_paise: number;
  line_discount_paise: number;
  cart_discount_paise: number;
  taxable_value_paise: number;
  cgst_paise: number;
  sgst_paise: number;
  igst_paise: number;
  cess_paise: number;
  charges_paise: number;
  round_off_paise: number;
  total_paise: number;
  tax_breakup: GstSlabSummary[];
}

export function lineDiscountPaise(discount: PricingLine['line_discount'], grossPaise: number): number {
  if (!discount || grossPaise <= 0) return 0;
  const raw = discount.type === 'FLAT' ? discount.value : roundPaise(new Decimal(grossPaise).mul(discount.value).div(100));
  return Math.min(Math.max(raw, 0), grossPaise);
}

export function cartDiscountPaise(
  discount: { type: 'FLAT' | 'PCT'; value: number } | null,
  lines: { after_line_discount_paise: number; discount_exempt: boolean }[]
): number {
  if (!discount) return 0;
  const base = lines.filter((l) => !l.discount_exempt).reduce((sum, l) => sum + l.after_line_discount_paise, 0);
  if (base <= 0) return 0;
  const raw = discount.type === 'FLAT' ? discount.value : roundPaise(new Decimal(base).mul(discount.value).div(100));
  return Math.min(Math.max(raw, 0), base);
}

/** Rule DS-2: floor-divide, then hand the 0..n-1 leftover paise to the largest lines first. */
export function apportionCartDiscount(
  cartDiscount: number,
  lines: { line_group_id: string; after_line_discount_paise: number; discount_exempt: boolean }[]
): Record<string, number> {
  const shares: Record<string, number> = {};
  for (const l of lines) shares[l.line_group_id] = 0;
  if (cartDiscount <= 0) return shares;

  const eligible = lines.filter((l) => !l.discount_exempt && l.after_line_discount_paise > 0);
  const totalBase = eligible.reduce((sum, l) => sum + l.after_line_discount_paise, 0);
  if (totalBase <= 0) return shares;

  let assigned = 0;
  const floored = eligible.map((l) => {
    const share = Math.floor((cartDiscount * l.after_line_discount_paise) / totalBase);
    assigned += share;
    return { line_group_id: l.line_group_id, share, base: l.after_line_discount_paise };
  });

  let residual = cartDiscount - assigned;
  const byDescendingBase = [...floored].sort((a, b) => b.base - a.base);
  for (let i = 0; residual > 0 && i < byDescendingBase.length; i += 1, residual -= 1) {
    byDescendingBase[i].share += 1;
  }
  for (const f of floored) shares[f.line_group_id] = f.share;
  return shares;
}

/** Rule TX-1: tax derived by subtraction when inclusive, never independently rounded. */
export function splitTaxable(preTaxPaise: number, gstRate: number, taxInclusive: boolean): { taxable: number; tax: number } {
  if (preTaxPaise <= 0) return { taxable: 0, tax: 0 };
  if (!taxInclusive) {
    const tax = roundPaise(new Decimal(preTaxPaise).mul(gstRate).div(100));
    return { taxable: preTaxPaise, tax };
  }
  const taxable = roundPaise(new Decimal(preTaxPaise).mul(100).div(new Decimal(100).plus(gstRate)));
  return { taxable, tax: preTaxPaise - taxable };
}

/** Rule TX-2: odd paise always to SGST. */
export function splitCgstSgstIgst(taxPaise: number, supplyType: 'INTRA_STATE' | 'INTER_STATE') {
  if (supplyType === 'INTER_STATE') return { cgst: 0, sgst: 0, igst: taxPaise };
  const cgst = Math.floor(taxPaise / 2);
  return { cgst, sgst: taxPaise - cgst, igst: 0 };
}

export function computeRoundOff(preRoundTotalPaise: number, mode: 'NEAREST' | 'UP' | 'DOWN' | 'NONE'): number {
  if (mode === 'NONE') return 0;
  const rupees = preRoundTotalPaise / 100;
  let roundedRupees: number;
  if (mode === 'UP') roundedRupees = Math.ceil(rupees);
  else if (mode === 'DOWN') roundedRupees = Math.floor(rupees);
  else roundedRupees = Math.round(rupees);
  return Math.round(roundedRupees * 100) - preRoundTotalPaise;
}

export interface ComputeTotalsInput {
  lines: PricingLine[];
  cart_discount: { type: 'FLAT' | 'PCT'; value: number } | null;
  charges_paise: number;
  supply_type: 'INTRA_STATE' | 'INTER_STATE';
  round_off_mode: 'NEAREST' | 'UP' | 'DOWN' | 'NONE';
}

export function computeTotals(input: ComputeTotalsInput): InvoiceTotals {
  const withGross = input.lines.map((line) => {
    const discount = lineDiscountPaise(line.line_discount, line.gross_paise);
    return { line, discount, afterLineDiscount: line.gross_paise - discount };
  });

  const cartDiscount = cartDiscountPaise(
    input.cart_discount,
    withGross.map((w) => ({ after_line_discount_paise: w.afterLineDiscount, discount_exempt: w.line.discount_exempt }))
  );
  const shares = apportionCartDiscount(
    cartDiscount,
    withGross.map((w) => ({
      line_group_id: w.line.line_group_id,
      after_line_discount_paise: w.afterLineDiscount,
      discount_exempt: w.line.discount_exempt,
    }))
  );

  const gstSlabs = new Map<number, GstSlabSummary>();
  let grossSum = 0;
  let lineDiscountSum = 0;
  let taxableSum = 0;
  let taxSum = 0;
  let cgstSum = 0;
  let sgstSum = 0;
  let igstSum = 0;

  const lines: PricingLineResult[] = withGross.map((w) => {
    const share = shares[w.line.line_group_id] ?? 0;
    const preTax = w.afterLineDiscount - share;
    const { taxable, tax } = splitTaxable(preTax, w.line.gst_rate, w.line.tax_inclusive);
    const { cgst, sgst, igst } = splitCgstSgstIgst(tax, input.supply_type);

    grossSum += w.line.gross_paise;
    lineDiscountSum += w.discount;
    taxableSum += taxable;
    taxSum += tax;
    cgstSum += cgst;
    sgstSum += sgst;
    igstSum += igst;

    const slab = gstSlabs.get(w.line.gst_rate) ?? { rate: w.line.gst_rate, taxable_paise: 0, cgst_paise: 0, sgst_paise: 0, igst_paise: 0 };
    slab.taxable_paise += taxable;
    slab.cgst_paise += cgst;
    slab.sgst_paise += sgst;
    slab.igst_paise += igst;
    gstSlabs.set(w.line.gst_rate, slab);

    return {
      line_group_id: w.line.line_group_id,
      gross_paise: w.line.gross_paise,
      line_discount_paise: w.discount,
      after_line_discount_paise: w.afterLineDiscount,
      cart_discount_share_paise: share,
      pre_tax_paise: preTax,
      taxable_value_paise: taxable,
      tax_amount_paise: tax,
      cgst_paise: cgst,
      sgst_paise: sgst,
      igst_paise: igst,
      line_total_paise: taxable + tax,
    };
  });

  const preRound = taxableSum + taxSum + input.charges_paise;
  const roundOff = computeRoundOff(preRound, input.round_off_mode);

  return {
    lines,
    gross_paise: grossSum,
    line_discount_paise: lineDiscountSum,
    cart_discount_paise: cartDiscount,
    taxable_value_paise: taxableSum,
    cgst_paise: cgstSum,
    sgst_paise: sgstSum,
    igst_paise: igstSum,
    cess_paise: 0,
    charges_paise: input.charges_paise,
    round_off_paise: roundOff,
    total_paise: preRound + roundOff,
    tax_breakup: Array.from(gstSlabs.values()).sort((a, b) => a.rate - b.rate),
  };
}
