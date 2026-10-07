import Decimal from 'decimal.js';

/**
 * REQUIREMENTS.md §0.1: money is integer paise everywhere; intermediate
 * math that produces fractions of a paise MUST use decimal.js and round
 * exactly once, at the point the rule specifies. Default rounding is
 * half-up away from zero.
 */
Decimal.set({ rounding: Decimal.ROUND_HALF_UP });

export function roundPaise(value: Decimal.Value): number {
  return new Decimal(value).toDecimalPlaces(0, Decimal.ROUND_HALF_UP).toNumber();
}

/** Display boundary only — REQUIREMENTS.md §0.1: divide by 100 here, nowhere else. */
const INR_FORMATTER = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  maximumFractionDigits: 2,
});

export function formatPaise(paise: number): string {
  return INR_FORMATTER.format(paise / 100);
}

/** Signed variant for lines like round_off that print with an explicit +/-. */
export function formatSignedPaise(paise: number): string {
  const formatted = formatPaise(Math.abs(paise));
  if (paise > 0) return `+${formatted}`;
  if (paise < 0) return `-${formatted}`;
  return formatted;
}
