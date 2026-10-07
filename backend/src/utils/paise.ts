/**
 * DATABASE_SCHEMA.md §9.4: Strapi's `biginteger` serialises to a string in
 * JSON (and node-postgres returns BIGINT columns as strings for the same
 * reason — safe-integer overflow). This is the single coercion point so no
 * caller ever does string arithmetic on money.
 *
 * Safe up to 2^53-1 paise (~₹90 trillion) per REQUIREMENTS.md §0.1 — ample
 * for a single store's ledger, and the same ceiling the spec itself cites.
 */

export function toPaise(value: string | number | bigint | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  const n = typeof value === 'bigint' ? Number(value) : Number(value);
  if (!Number.isSafeInteger(n)) {
    throw new RangeError(`Paise value ${String(value)} exceeds Number.MAX_SAFE_INTEGER`);
  }
  return n;
}

export function fromPaise(value: number | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  if (!Number.isSafeInteger(value)) {
    throw new RangeError(`Paise value ${value} is not a safe integer`);
  }
  return String(value);
}

/** Recursively coerces every key in `keys` from string/bigint to number, in place on a shallow copy. */
export function coercePaiseFields<T extends Record<string, any>>(row: T, keys: (keyof T)[]): T {
  const out: T = { ...row };
  for (const key of keys) {
    if (key in out) {
      (out as any)[key] = toPaise(out[key] as any);
    }
  }
  return out;
}
