/** Mirrors backend/src/api/product-import/services/product-import.ts. */

export interface RawImportRow {
  row_number: number;
  product_name?: string;
  sku?: string;
  category?: string;
  base_unit?: string;
  mrp?: string;
  retail_rate?: string;
  wholesale_tier1_rate?: string;
  wholesale_tier2_rate?: string;
  gst_slab?: string;
  current_stock?: string;
  hsn_code?: string;
}

/** `code` is translated via `import.err.<code>` with `params` substituted into `{name}` placeholders; `message` is the English fallback. */
export interface ImportRowError {
  code: string;
  params?: Record<string, string | number>;
  message: string;
}

export interface ImportRowResult {
  row_number: number;
  status: 'CREATED' | 'UPDATED' | 'FAILED';
  product_id?: string;
  sku?: string;
  product_name?: string;
  stock_adjusted_base?: string;
  errors?: ImportRowError[];
  /** Original cells of a FAILED row (added by the BFF). */
  source?: RawImportRow;
}

export interface ImportSummary {
  total_rows: number;
  created: number;
  updated: number;
  failed: number;
  skipped_sample_rows: number;
  rows: ImportRowResult[];
}

/** Template column order (also the header of the failed-rows download). */
export const IMPORT_COLUMN_KEYS = [
  'product_name',
  'sku',
  'category',
  'base_unit',
  'mrp',
  'retail_rate',
  'wholesale_tier1_rate',
  'wholesale_tier2_rate',
  'gst_slab',
  'current_stock',
  'hsn_code',
] as const;
