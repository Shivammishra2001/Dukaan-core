import type { CustomerLite } from '@/types/pos';

/** REQUIREMENTS.md §4.2. Rule CR-1: credit_limit_enabled = false means no limit at all. */
export function creditHeadroomPaise(customer: CustomerLite): number | null {
  if (!customer.credit_limit_enabled) return null;
  return customer.credit_limit_paise - customer.current_balance_paise;
}

export function wouldBreachCreditLimit(customer: CustomerLite, additionalCreditPaise: number): boolean {
  const headroom = creditHeadroomPaise(customer);
  if (headroom === null) return false;
  return additionalCreditPaise > headroom;
}
