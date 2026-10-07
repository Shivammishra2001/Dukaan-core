/**
 * REQUIREMENTS.md §0.3: business day boundary is store-configurable
 * (default 00:00 IST); financial year starts at store.financial_year_start
 * (default April). India Standard Time has no DST, so a fixed +5:30 offset
 * is correct for every store in this MVP (the only supported timezone is
 * 'Asia/Kolkata') — a real multi-timezone deployment would need a proper
 * IANA timezone library here instead of this hardcoded offset.
 */
const IST_OFFSET_MINUTES = 5 * 60 + 30;

export function toIstDate(utcDate: Date): { year: number; month: number; day: number } {
  const istMs = utcDate.getTime() + IST_OFFSET_MINUTES * 60_000;
  const ist = new Date(istMs);
  return { year: ist.getUTCFullYear(), month: ist.getUTCMonth() + 1, day: ist.getUTCDate() };
}

export function businessDateIso(utcDate: Date): string {
  const { year, month, day } = toIstDate(utcDate);
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/** e.g. financial_year_start=4 (April), date in Mar 2027 -> "2026-27"; date in Apr 2027 -> "2027-28". */
export function financialYear(utcDate: Date, financialYearStart: number): string {
  const { year, month } = toIstDate(utcDate);
  const fyStartYear = month >= financialYearStart ? year : year - 1;
  return `${fyStartYear}-${String((fyStartYear + 1) % 100).padStart(2, '0')}`;
}
