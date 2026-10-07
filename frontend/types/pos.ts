/**
 * Shared POS domain types. Mirrors DATABASE_SCHEMA.md / REQUIREMENTS.md
 * naming exactly (base_unit, unit_code, *_paise, qty_base) so this vocabulary
 * carries straight through to the real API contracts in Milestone 3+.
 *
 * Money: integer paise everywhere (REQUIREMENTS.md §0.1). Quantities are
 * decimal STRINGS, never float (§0.2) — arithmetic on them always goes
 * through decimal.js in lib/units.ts / lib/pricing.ts.
 */

export type BaseUnit = 'G' | 'ML' | 'PCS';

export type UnitCode =
  | 'G' | 'KG' | 'QUINTAL'
  | 'ML' | 'L'
  | 'PCS' | 'DOZEN'
  | 'PACKET' | 'CARTON' | 'BORI' | 'CRATE';

export type PriceSource = 'PRODUCT' | 'UNIT_OVERRIDE' | 'MANUAL';

export interface UnitConversion {
  unit_code: UnitCode;
  factor_to_base: number; // NUMERIC(18,6) in the DB; number is fine at UI precision
  is_sale_unit: boolean;
  is_purchase_unit: boolean;
  price_override_paise?: number | null; // Rule PR-1
  label_local?: string;
}

export type DiscountKind = 'FLAT' | 'PCT';

export interface Discount {
  type: DiscountKind;
  value: number; // FLAT: paise. PCT: 0-100
}

export interface Product {
  id: string;
  sku: string;
  barcode?: string;
  name: string;
  name_local?: string;
  category: string;
  base_unit: BaseUnit;
  allow_fractional: boolean;
  quantity_precision: 0 | 1 | 2 | 3;
  default_sale_unit: UnitCode;
  default_purchase_unit: UnitCode; // DATABASE_SCHEMA.md §3.2 — what a GRN/inward screen opens with (Milestone 6 addition; POS never needed this)
  pricing_unit: UnitCode;
  sell_rate_paise: number; // per pricing_unit (REQUIREMENTS.md §1.4)
  mrp_paise?: number | null; // per pricing_unit, same basis as sell_rate_paise
  wholesale_tier1_rate_paise?: number | null; // per pricing_unit — B2B order qty in [5,20) default_purchase_unit
  wholesale_tier2_rate_paise?: number | null; // per pricing_unit — B2B order qty >= 20 default_purchase_unit
  gst_rate: number;
  tax_inclusive: boolean;
  discount_exempt: boolean;
  hsn_code?: string;
  unit_conversions: UnitConversion[];
  stock_base: number; // mock on-hand, for the stock-status badge only
  is_loose: boolean; // drives Quick Grid eligibility (non-barcode, fractional-qty items)
}

/** Snapshot captured onto the cart line at add-time — REQUIREMENTS.md's
 * "invoice must be reproducible even if masters change" principle, applied
 * to the pre-checkout cart too (masters can change mid-session on another
 * terminal). */
export interface ProductSnapshot {
  name: string;
  name_local?: string;
  base_unit: BaseUnit;
  hsn_code?: string;
  gst_rate: number;
  tax_inclusive: boolean;
  discount_exempt: boolean;
  pricing_unit: UnitCode;
  quantity_precision: 0 | 1 | 2 | 3;
  allow_fractional: boolean;
  mrp_paise?: number | null;
  unit_conversions: UnitConversion[];
}

export interface CartLine {
  line_id: string;
  line_group_id: string;
  product_id: string;
  product_snapshot: ProductSnapshot;
  entered_qty: string; // decimal string
  entered_unit: UnitCode;
  qty_base: string; // decimal string, 4dp (Rule UC-5)
  /**
   * Effective price used for gross computation. Denominated per
   * `product_snapshot.pricing_unit` when price_source = PRODUCT (Rule
   * PR-3 tier 4), or per `entered_unit` when price_source is UNIT_OVERRIDE
   * (Rule PR-1: "scales linearly") or MANUAL (cashier typed a per-unit
   * price). See lib/pricing.ts `lineGrossPaise`.
   */
  unit_price_paise: number;
  price_source: PriceSource;
  line_discount: Discount | null;
  discount_exempt: boolean;
  mrp_override_approved: boolean; // stub for permission `pos.override_mrp` (audited server-side)
  note?: string;
}

export interface CustomerLite {
  id: string;
  name: string;
  phone_last4?: string;
  credit_limit_enabled: boolean;
  credit_limit_paise: number;
  current_balance_paise: number;
}

export type PaymentMethod = 'CASH' | 'UPI' | 'CARD' | 'CREDIT';

export interface Payment {
  method: PaymentMethod;
  amount_paise: number;
  tendered_paise?: number; // CASH only
  change_paise?: number; // CASH only
  reference?: string; // UPI/CARD reference
}

export interface Charge {
  label: string;
  amount_paise: number;
}

export type CartStatus = 'ACTIVE' | 'PARKED' | 'SUBMITTING' | 'SUBMITTED';

export interface ParkedCart {
  cart_uuid: string;
  label: string;
  parked_at: string;
  lines: CartLine[];
  customer: CustomerLite | null;
  cart_discount: Discount | null;
  payments: Payment[];
}

export type SupplyType = 'INTRA_STATE' | 'INTER_STATE';
export type RoundOffMode = 'NEAREST' | 'UP' | 'DOWN' | 'NONE';
export type CreditEnforcementMode = 'BLOCK' | 'WARN' | 'ALLOW_WITH_APPROVAL';

/**
 * Milestone 4 addition — mirrors backend/src/api/stores-onboard/services/presets.ts.
 * NOT in DATABASE_SCHEMA.md/API_CONTRACTS.md; see that file's header comment
 * for why this exists alongside (not instead of) the documented KIRANA/RETAIL
 * `default_mode` archetypes.
 */
export type BusinessPreset = 'KIRANA' | 'SALOON' | 'DHABA' | 'REPAIR' | 'DISTRIBUTOR';

export interface StoreConfig {
  store_id: string;
  store_code: string; // DATABASE_SCHEMA.md §2.2 `stores.code` — used in the offline provisional invoice number
  store_name: string;
  counter_id: string;
  counter_name: string;
  state_code: string;
  supply_type: SupplyType;
  round_off_mode: RoundOffMode;
  credit_enforcement_mode: CreditEnforcementMode;
  business_preset: BusinessPreset;
  track_inventory: boolean; // false for SALOON/DHABA — hides stock badges/filters
  shift_enabled: boolean; // DATABASE_SCHEMA.md §2.3 store.config.shift.enabled
}

export interface ActionResult {
  ok: boolean;
  error?: string; // error code from REQUIREMENTS.md §7.1's catalogue where applicable
}

/** A real counter belonging to the session's store — see lib/counter-client.ts. Distinct from StoreConfig's mock counter_id/counter_name, which never resolve to an actual backend row. */
export interface CounterLite {
  id: string;
  code: string;
  name: string;
}
