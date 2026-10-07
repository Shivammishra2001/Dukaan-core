import type { CustomerLite, Product, StoreConfig } from '@/types/pos';

/**
 * Standalone seed data for the POS UI. Milestone 2 is scoped to "complete a
 * real bill, online" (TASKS_BREAKDOWN.md) with no catalogue sync yet
 * (Dexie/IndexedDB catalogue caching is Milestone 3) — this stands in for
 * `GET /api/pos/bootstrap` until that route exists. Shaped exactly like the
 * Strapi Product/UnitConversion schemas from Milestone 1 so swapping this
 * for a real fetch is a drop-in change.
 */

export const STORE_CONFIG: StoreConfig = {
  store_id: 'store-k1',
  store_code: 'K1',
  store_name: 'Sharma General Store',
  counter_id: 'counter-1',
  counter_name: 'C1',
  state_code: '09',
  supply_type: 'INTRA_STATE',
  round_off_mode: 'NEAREST',
  credit_enforcement_mode: 'ALLOW_WITH_APPROVAL',
  business_preset: 'KIRANA',
  track_inventory: true,
  shift_enabled: true,
};

const g = (
  id: string,
  sku: string,
  name: string,
  nameLocal: string,
  category: string,
  sellRatePerKgPaise: number,
  gstRate: number,
  opts: Partial<Product> = {}
): Product => ({
  id,
  sku,
  name,
  name_local: nameLocal,
  category,
  base_unit: 'G',
  allow_fractional: true,
  quantity_precision: 0,
  default_sale_unit: 'G',
  default_purchase_unit: 'KG',
  pricing_unit: 'KG',
  sell_rate_paise: sellRatePerKgPaise,
  mrp_paise: opts.mrp_paise ?? null,
  gst_rate: gstRate,
  tax_inclusive: gstRate > 0,
  discount_exempt: false,
  unit_conversions: [
    { unit_code: 'G', factor_to_base: 1, is_sale_unit: true, is_purchase_unit: false },
    { unit_code: 'KG', factor_to_base: 1000, is_sale_unit: true, is_purchase_unit: true },
    { unit_code: 'QUINTAL', factor_to_base: 100000, is_sale_unit: false, is_purchase_unit: true },
    ...(opts.unit_conversions ?? []),
  ],
  stock_base: 25000,
  is_loose: true,
  ...opts,
});

const ml = (
  id: string,
  sku: string,
  name: string,
  nameLocal: string,
  category: string,
  sellRatePerLPaise: number,
  gstRate: number,
  opts: Partial<Product> = {}
): Product => ({
  id,
  sku,
  name,
  name_local: nameLocal,
  category,
  base_unit: 'ML',
  allow_fractional: true,
  quantity_precision: 0,
  default_sale_unit: 'ML',
  default_purchase_unit: 'L',
  pricing_unit: 'L',
  sell_rate_paise: sellRatePerLPaise,
  mrp_paise: opts.mrp_paise ?? null,
  gst_rate: gstRate,
  tax_inclusive: gstRate > 0,
  discount_exempt: false,
  unit_conversions: [
    { unit_code: 'ML', factor_to_base: 1, is_sale_unit: true, is_purchase_unit: false },
    { unit_code: 'L', factor_to_base: 1000, is_sale_unit: true, is_purchase_unit: true },
    ...(opts.unit_conversions ?? []),
  ],
  stock_base: 15000,
  is_loose: true,
  ...opts,
});

const pc = (
  id: string,
  sku: string,
  barcode: string,
  name: string,
  nameLocal: string,
  category: string,
  mrpPaise: number,
  gstRate: number,
  opts: Partial<Product> = {}
): Product => ({
  id,
  sku,
  barcode,
  name,
  name_local: nameLocal,
  category,
  base_unit: 'PCS',
  allow_fractional: false,
  quantity_precision: 0,
  default_sale_unit: 'PCS',
  default_purchase_unit: 'PCS',
  pricing_unit: 'PCS',
  sell_rate_paise: mrpPaise,
  mrp_paise: mrpPaise,
  gst_rate: gstRate,
  tax_inclusive: true,
  discount_exempt: false,
  unit_conversions: [
    { unit_code: 'PCS', factor_to_base: 1, is_sale_unit: true, is_purchase_unit: true },
    { unit_code: 'DOZEN', factor_to_base: 12, is_sale_unit: false, is_purchase_unit: true },
    ...(opts.unit_conversions ?? []),
  ],
  stock_base: 120,
  is_loose: false,
  ...opts,
});

export const QUICK_GRID_PRODUCTS: Product[] = [
  g('p-chini', 'LOOSE-CHINI', 'Sugar', 'चीनी', 'Grocery', 4500, 5, { mrp_paise: 4800 }),
  g('p-daal-arhar', 'LOOSE-DAAL-ARHAR', 'Arhar Dal', 'अरहर दाल', 'Grocery', 14000, 0),
  g('p-daal-chana', 'LOOSE-DAAL-CHANA', 'Chana Dal', 'चना दाल', 'Grocery', 9500, 0),
  ml('p-tel-sarso', 'LOOSE-TEL-SARSO', 'Mustard Oil', 'सरसों तेल', 'Grocery', 16500, 5, { mrp_paise: 17500 }),
  ml('p-tel-sunflower', 'LOOSE-TEL-SUN', 'Sunflower Oil', 'सूरजमुखी तेल', 'Grocery', 15000, 5),
  g('p-masala-haldi', 'LOOSE-MASALA-HALDI', 'Turmeric Powder', 'हल्दी', 'Masala', 32000, 5),
  g('p-masala-mirch', 'LOOSE-MASALA-MIRCH', 'Chilli Powder', 'लाल मिर्च', 'Masala', 38000, 5),
  g('p-atta', 'LOOSE-ATTA', 'Wheat Flour', 'आटा', 'Grocery', 3800, 0),
  g('p-chawal', 'LOOSE-CHAWAL', 'Basmati Rice', 'चावल', 'Grocery', 8500, 5),
  g('p-namak', 'LOOSE-NAMAK', 'Salt', 'नमक', 'Grocery', 2200, 0),
];

export const CATALOG_PRODUCTS: Product[] = [
  ...QUICK_GRID_PRODUCTS,
  pc('p-soap-lux', 'SOAP-LUX-100', '8901030826319', 'Lux Soap 100g', 'लक्स साबुन', 'Personal Care', 4000, 18),
  pc('p-biscuit-parle', 'BISC-PARLEG-100', '8901063010019', 'Parle-G Biscuit 100g', 'पार्ले-जी बिस्किट', 'Snacks', 2000, 18),
  pc('p-maggi', 'NOODLE-MAGGI-70', '8901058851922', 'Maggi Noodles 70g', 'मैगी नूडल्स', 'Snacks', 1400, 18, { stock_base: 6 }),
  pc('p-toothpaste', 'TP-COLGATE-100', '8901314123456', 'Colgate Toothpaste 100g', 'कोलगेट टूथपेस्ट', 'Personal Care', 5500, 18),
  pc('p-milk-carton', 'MILK-CRTN-24', '8901234567890', 'Milk Pouch Carton (24x500ml)', 'दूध कार्टन', 'Dairy', 96000, 0, {
    unit_conversions: [{ unit_code: 'CARTON', factor_to_base: 24, is_sale_unit: true, is_purchase_unit: true }],
    stock_base: 3,
  }),
  pc('p-cold-drink', 'CD-COLA-750', '8901491101026', 'Cola 750ml', 'कोला', 'Beverages', 4000, 28, { stock_base: 0 }),
  pc('p-chips', 'CHIPS-LAYS-52', '8901491102030', "Lay's Chips 52g", 'चिप्स', 'Snacks', 2000, 12),
  pc('p-shampoo', 'SHMP-CLINIC-80', '8901138515639', 'Clinic Plus Shampoo 80ml', 'शैम्पू', 'Personal Care', 3500, 18),
  pc('p-notebook', 'STAT-NB-200', '8904004401234', 'Notebook 200pg', 'कॉपी', 'Stationery', 6000, 12),
  pc('p-battery', 'BATT-AA-2PK', '8904004409876', 'AA Battery Pack of 2', 'बैटरी', 'Household', 5000, 18),
];

export const CATEGORIES = Array.from(new Set(CATALOG_PRODUCTS.map((p) => p.category)));

export const MOCK_CUSTOMERS: CustomerLite[] = [
  { id: 'c-walkin', name: 'Walk-in Customer', credit_limit_enabled: false, credit_limit_paise: 0, current_balance_paise: 0 },
  {
    id: 'c-ramesh',
    name: 'Ramesh Kumar',
    phone_last4: '4521',
    credit_limit_enabled: true,
    credit_limit_paise: 200000,
    current_balance_paise: 190000,
  },
  {
    id: 'c-sunita',
    name: 'Sunita Devi',
    phone_last4: '7788',
    credit_limit_enabled: true,
    credit_limit_paise: 500000,
    current_balance_paise: 120000,
  },
  {
    id: 'c-vikram',
    name: 'Vikram Traders',
    phone_last4: '9012',
    credit_limit_enabled: true,
    credit_limit_paise: 1000000,
    current_balance_paise: 1000000, // exactly at limit — headroom 0
  },
  {
    id: 'c-anita',
    name: 'Anita Sharma',
    phone_last4: '3344',
    credit_limit_enabled: false,
    credit_limit_paise: 0,
    current_balance_paise: 0,
  },
];

export function findProductByBarcode(barcode: string): Product | undefined {
  return CATALOG_PRODUCTS.find((p) => p.barcode === barcode || p.sku === barcode);
}

export function getMockStockBase(productId: string): number | undefined {
  return CATALOG_PRODUCTS.find((p) => p.id === productId)?.stock_base;
}

export function stockStatus(product: Product): 'IN_STOCK' | 'LOW' | 'OUT' {
  if (product.stock_base <= 0) return 'OUT';
  const lowThresholdBase = product.base_unit === 'PCS' ? 10 : 2000;
  if (product.stock_base <= lowThresholdBase) return 'LOW';
  return 'IN_STOCK';
}
