import type { DocumentId, Paise } from './checkout';

/** Mirrors backend/src/api/product + inventory-batch schema.json. */

export type BaseUnit = 'G' | 'ML' | 'PCS';

export interface ProductRow {
  id: DocumentId;
  sku: string;
  name: string;
  name_local?: string;
  category?: { id: DocumentId; name: string } | null;
  base_unit: BaseUnit;
  default_sale_unit: string;
  pricing_unit: string;
  mrp_paise: Paise | null;
  sell_rate_paise: Paise;
  /** Wholesale rate per pricing_unit for a B2B line whose qty (in the product's default_purchase_unit) is in [5, 20). Null = falls back to sell_rate_paise at booking time. */
  wholesale_tier1_rate_paise: Paise | null;
  /** Wholesale rate per pricing_unit for a B2B line whose qty (in default_purchase_unit) is >= 20. Null = falls back to tier1, then sell_rate_paise. */
  wholesale_tier2_rate_paise: Paise | null;
  last_cost_paise: Paise | null;
  gst_rate: number;
  is_service: boolean;
  is_active: boolean;
  /** Sum of ACTIVE batches' current_stock_base — products have no direct stock field (DATABASE_SCHEMA.md §4.1: stock lives on inventory_batches). Always '0' for services. */
  current_stock_base: string;
}

export interface UpdateProductRatesRequest {
  mrp_paise?: number;
  sell_rate_paise?: number;
  wholesale_tier1_rate_paise?: number | null;
  wholesale_tier2_rate_paise?: number | null;
}

export interface CreateProductRequest {
  sku: string;
  name: string;
  name_local?: string;
  base_unit: BaseUnit;
  default_sale_unit: string;
  default_purchase_unit: string;
  pricing_unit: string;
  sell_rate_paise: number;
  mrp_paise?: number;
  gst_rate?: number;
  is_service?: boolean;
  /** When default_purchase_unit differs from base_unit (e.g. a "CARTON" bulk unit), how many base units it equals — the BFF uses this to also create that unit_conversion row, in addition to the always-created base_unit anchor (factor 1). Omit when default_purchase_unit === base_unit. */
  purchase_unit_factor?: number;
}
