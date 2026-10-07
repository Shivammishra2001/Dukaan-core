import Decimal from 'decimal.js';
import type { CartLine, Discount, Payment, RoundOffMode, SupplyType } from '@/types/pos';
import { roundPaise } from './money';
import { findConversion, PosError } from './units';

/**
 * REQUIREMENTS.md §2 — Pricing, Discounts & Tax Calculation, ported as a
 * pure, framework-agnostic module (no Zustand/React imports) so it can be
 * lifted into a shared `packages/pricing` package unchanged once the
 * monorepo exists (Rule FE-4: client and server must run identical code —
 * this file is that client half; the server still recomputes and is
 * authoritative).
 *
 * The full worked invoice in §2.8 (Sugar/Biscuit/Soap, 5% cart discount)
 * was hand-verified against this implementation while writing it — see the
 * PR description / commit message for the trace. It reproduces to the
 * paise, including the CGST 14.67 / SGST 14.68 odd-paise split and the
 * -₹0.13 round-off.
 */

export interface LineTotals {
  line_id: string;
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
  line_total_paise: number; // taxable + tax
}

export interface GstSlabSummary {
  rate: number;
  taxable_paise: number;
  cgst_paise: number;
  sgst_paise: number;
  tax_paise: number;
}

export interface InvoiceTotals {
  lines: LineTotals[];
  gross_paise: number;
  line_discount_paise: number;
  cart_discount_paise: number;
  taxable_value_paise: number;
  cgst_paise: number;
  sgst_paise: number;
  igst_paise: number;
  tax_paise: number;
  charges_paise: number;
  round_off_paise: number;
  total_paise: number;
  gst_summary: GstSlabSummary[];
}

/**
 * Step 1 + Rule PR-1/PR-3 tiers 2 & 4 (tier 1 "manual line override" and
 * tier 3 "batch pricing" aren't modelled by this client-side preview —
 * batch selection happens server-side at checkout; see checkout-modal.tsx).
 *
 * `unit_price_paise` is per `pricing_unit` for PRODUCT, and per
 * `entered_unit` for UNIT_OVERRIDE/MANUAL (Rule PR-1: "the override is
 * treated as the line gross for entered_qty = 1 of that unit and scales
 * linearly").
 */
export function lineGrossPaise(line: CartLine): number {
  if (line.price_source === 'PRODUCT') {
    const pricingConv = findConversion(line.product_snapshot.unit_conversions, line.product_snapshot.pricing_unit);
    const ratePerBase = new Decimal(line.unit_price_paise).div(pricingConv.factor_to_base);
    return roundPaise(ratePerBase.mul(line.qty_base));
  }
  return roundPaise(new Decimal(line.unit_price_paise).mul(line.entered_qty));
}

/** Rule DS-3: cap at the line's gross, never negative. */
export function lineDiscountPaise(discount: Discount | null, grossPaise: number): number {
  if (!discount || grossPaise <= 0) return 0;
  const raw = discount.type === 'FLAT' ? discount.value : roundPaise(new Decimal(grossPaise).mul(discount.value).div(100));
  return Math.min(Math.max(raw, 0), grossPaise);
}

/** Rule DS-1: exempt lines are excluded from the cart-discount base entirely. */
export function cartDiscountPaise(
  discount: Discount | null,
  lines: { after_line_discount_paise: number; discount_exempt: boolean }[]
): number {
  if (!discount) return 0;
  const base = lines.filter((l) => !l.discount_exempt).reduce((sum, l) => sum + l.after_line_discount_paise, 0);
  if (base <= 0) return 0;
  const raw = discount.type === 'FLAT' ? discount.value : roundPaise(new Decimal(base).mul(discount.value).div(100));
  return Math.min(Math.max(raw, 0), base);
}

/**
 * Rule DS-2: apportion pro-rata by floor division, then hand out the
 * 0..n-1 leftover paise one at a time to the largest lines first —
 * guarantees Σ shares === cartDiscountPaise exactly, every time.
 */
export function apportionCartDiscount(
  cartDiscount: number,
  lines: { line_id: string; after_line_discount_paise: number; discount_exempt: boolean }[]
): Record<string, number> {
  const shares: Record<string, number> = {};
  for (const l of lines) shares[l.line_id] = 0;
  if (cartDiscount <= 0) return shares;

  const eligible = lines.filter((l) => !l.discount_exempt && l.after_line_discount_paise > 0);
  const totalBase = eligible.reduce((sum, l) => sum + l.after_line_discount_paise, 0);
  if (totalBase <= 0) return shares;

  let assigned = 0;
  const floored = eligible.map((l) => {
    const share = Math.floor((cartDiscount * l.after_line_discount_paise) / totalBase);
    assigned += share;
    return { line_id: l.line_id, share, base: l.after_line_discount_paise };
  });

  let residual = cartDiscount - assigned;
  const byDescendingBase = [...floored].sort((a, b) => b.base - a.base);
  for (let i = 0; residual > 0 && i < byDescendingBase.length; i += 1, residual -= 1) {
    byDescendingBase[i].share += 1;
  }
  for (const f of floored) shares[f.line_id] = f.share;
  return shares;
}

/** REQUIREMENTS.md §2.3 (exclusive) / §2.4 (inclusive) + Rule TX-1 (subtraction, never independent rounding). */
export function splitTaxable(preTaxPaise: number, gstRate: number, taxInclusive: boolean): { taxable: number; tax: number } {
  if (preTaxPaise <= 0) return { taxable: 0, tax: 0 };
  if (!taxInclusive) {
    const tax = roundPaise(new Decimal(preTaxPaise).mul(gstRate).div(100));
    return { taxable: preTaxPaise, tax };
  }
  const taxable = roundPaise(new Decimal(preTaxPaise).mul(100).div(new Decimal(100).plus(gstRate)));
  return { taxable, tax: preTaxPaise - taxable };
}

/** Rule TX-2: odd paise always goes to SGST, deterministically. */
export function splitCgstSgstIgst(taxPaise: number, supplyType: SupplyType): { cgst: number; sgst: number; igst: number } {
  if (supplyType === 'INTER_STATE') return { cgst: 0, sgst: 0, igst: taxPaise };
  const cgst = Math.floor(taxPaise / 2);
  return { cgst, sgst: taxPaise - cgst, igst: 0 };
}

/** REQUIREMENTS.md §2.7. */
export function computeRoundOff(preRoundTotalPaise: number, mode: RoundOffMode): number {
  if (mode === 'NONE') return 0;
  const rupees = preRoundTotalPaise / 100;
  let roundedRupees: number;
  if (mode === 'UP') roundedRupees = Math.ceil(rupees);
  else if (mode === 'DOWN') roundedRupees = Math.floor(rupees);
  else roundedRupees = Math.round(rupees);
  return Math.round(roundedRupees * 100) - preRoundTotalPaise;
}

export interface TotalsInput {
  lines: CartLine[];
  cart_discount: Discount | null;
  charges: { amount_paise: number }[];
  supply_type: SupplyType;
  round_off_mode: RoundOffMode;
}

/** The full §2.2 pipeline, steps 1-12, in order. */
export function computeTotals(input: TotalsInput): InvoiceTotals {
  const withGross = input.lines.map((line) => {
    const gross = lineGrossPaise(line);
    const discount = lineDiscountPaise(line.line_discount, gross);
    return { line, gross, discount, afterLineDiscount: gross - discount };
  });

  const cartDiscount = cartDiscountPaise(
    input.cart_discount,
    withGross.map((w) => ({ after_line_discount_paise: w.afterLineDiscount, discount_exempt: w.line.discount_exempt }))
  );
  const shares = apportionCartDiscount(
    cartDiscount,
    withGross.map((w) => ({
      line_id: w.line.line_id,
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

  const lines: LineTotals[] = withGross.map((w) => {
    const share = shares[w.line.line_id] ?? 0;
    const preTax = w.afterLineDiscount - share;
    const { taxable, tax } = splitTaxable(preTax, w.line.product_snapshot.gst_rate, w.line.product_snapshot.tax_inclusive);
    const { cgst, sgst, igst } = splitCgstSgstIgst(tax, input.supply_type);

    grossSum += w.gross;
    lineDiscountSum += w.discount;
    taxableSum += taxable;
    taxSum += tax;
    cgstSum += cgst;
    sgstSum += sgst;
    igstSum += igst;

    const rate = w.line.product_snapshot.gst_rate;
    const slab = gstSlabs.get(rate) ?? { rate, taxable_paise: 0, cgst_paise: 0, sgst_paise: 0, tax_paise: 0 };
    slab.taxable_paise += taxable;
    slab.cgst_paise += cgst;
    slab.sgst_paise += sgst;
    slab.tax_paise += tax;
    gstSlabs.set(rate, slab);

    return {
      line_id: w.line.line_id,
      gross_paise: w.gross,
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

  const chargesPaise = input.charges.reduce((sum, c) => sum + c.amount_paise, 0);
  const preRound = taxableSum + taxSum + chargesPaise;
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
    tax_paise: taxSum,
    charges_paise: chargesPaise,
    round_off_paise: roundOff,
    total_paise: preRound + roundOff,
    gst_summary: Array.from(gstSlabs.values()).sort((a, b) => a.rate - b.rate),
  };
}

/** Rule PR-2: effective price must not exceed MRP, normalised to the same (pricing_unit) basis. */
export function exceedsMrp(line: CartLine): boolean {
  const mrp = line.product_snapshot.mrp_paise;
  if (mrp == null) return false;
  if (line.price_source === 'PRODUCT') {
    return line.unit_price_paise > mrp;
  }
  // UNIT_OVERRIDE / MANUAL are priced per entered_unit — normalise to pricing_unit for comparison.
  const pricingConv = findConversion(line.product_snapshot.unit_conversions, line.product_snapshot.pricing_unit);
  const enteredConv = findConversion(line.product_snapshot.unit_conversions, line.entered_unit);
  const pricePerPricingUnit = new Decimal(line.unit_price_paise)
    .div(enteredConv.factor_to_base)
    .mul(pricingConv.factor_to_base);
  return pricePerPricingUnit.gt(mrp);
}

/** Rule ERR_PAYMENT_MISMATCH: Σ payments must equal invoice_total exactly. */
export function paymentsCoverTotal(payments: Payment[], totalPaise: number): boolean {
  return payments.reduce((sum, p) => sum + p.amount_paise, 0) === totalPaise;
}

export { PosError };
