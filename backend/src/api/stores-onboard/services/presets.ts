/**
 * Milestone 4 addition — NOT in DATABASE_SCHEMA.md/REQUIREMENTS.md (see
 * backend/README.md and store/schema.json's `business_preset` field
 * comment). Five onboarding presets, each producing:
 *   1. a `store.config` overlay (merged onto the existing §2.3 JSONB shape
 *      — new keys are additive, nothing in the documented shape is removed)
 *   2. a `default_mode` (still just the two ADR-03 archetypes — presets
 *      that aren't loose-grocery retail map to whichever archetype's UI
 *      behaviour fits closer; a real product decision would probably want
 *      to extend `default_mode` properly instead of overloading KIRANA/RETAIL,
 *      which is exactly the kind of change that should go through the docs)
 *   3. 8-10 starter catalogue items to seed
 */

export type BusinessPreset = 'KIRANA' | 'SALOON' | 'DHABA' | 'REPAIR' | 'DISTRIBUTOR';

export interface SeedUnitConversion {
  unit_code: string;
  factor_to_base: number;
  is_sale_unit: boolean;
  is_purchase_unit: boolean;
}

export interface SeedProduct {
  sku: string;
  name: string;
  name_local?: string;
  base_unit: 'G' | 'ML' | 'PCS';
  is_service: boolean;
  allow_fractional: boolean;
  quantity_precision: 0 | 1 | 2 | 3;
  default_sale_unit: string;
  default_purchase_unit: string;
  pricing_unit: string;
  sell_rate_paise: number;
  mrp_paise?: number;
  gst_rate: number;
  tax_inclusive: boolean;
  extra_conversions?: SeedUnitConversion[];
}

export interface PresetDefinition {
  default_mode: 'KIRANA' | 'RETAIL';
  config_overlay: Record<string, unknown>;
  starter_products: SeedProduct[];
}

const loose = (sku: string, name: string, nameLocal: string, rupeesPerKg: number, gst: number): SeedProduct => ({
  sku,
  name,
  name_local: nameLocal,
  base_unit: 'G',
  is_service: false,
  allow_fractional: true,
  quantity_precision: 0,
  default_sale_unit: 'G',
  default_purchase_unit: 'KG',
  pricing_unit: 'KG',
  sell_rate_paise: rupeesPerKg * 100,
  gst_rate: gst,
  tax_inclusive: gst > 0,
  extra_conversions: [{ unit_code: 'KG', factor_to_base: 1000, is_sale_unit: true, is_purchase_unit: true }],
});

const service = (sku: string, name: string, nameLocal: string, rupees: number, gst = 18): SeedProduct => ({
  sku,
  name,
  name_local: nameLocal,
  base_unit: 'PCS',
  is_service: true,
  allow_fractional: false,
  quantity_precision: 0,
  default_sale_unit: 'PCS',
  default_purchase_unit: 'PCS',
  pricing_unit: 'PCS',
  sell_rate_paise: rupees * 100,
  gst_rate: gst,
  tax_inclusive: true,
});

const piece = (sku: string, name: string, nameLocal: string, rupees: number, gst = 18): SeedProduct => ({
  sku,
  name,
  name_local: nameLocal,
  base_unit: 'PCS',
  is_service: false,
  allow_fractional: false,
  quantity_precision: 0,
  default_sale_unit: 'PCS',
  default_purchase_unit: 'PCS',
  pricing_unit: 'PCS',
  sell_rate_paise: rupees * 100,
  mrp_paise: rupees * 100,
  gst_rate: gst,
  tax_inclusive: true,
});

const cartonGoods = (sku: string, name: string, nameLocal: string, rupeesPerCarton: number, unitsPerCarton: number, gst: number): SeedProduct => ({
  sku,
  name,
  name_local: nameLocal,
  base_unit: 'PCS',
  is_service: false,
  allow_fractional: false,
  quantity_precision: 0,
  default_sale_unit: 'CARTON',
  default_purchase_unit: 'CARTON',
  pricing_unit: 'CARTON',
  sell_rate_paise: rupeesPerCarton * 100,
  gst_rate: gst,
  tax_inclusive: gst > 0,
  extra_conversions: [{ unit_code: 'CARTON', factor_to_base: unitsPerCarton, is_sale_unit: true, is_purchase_unit: true }],
});

export const PRESETS: Record<BusinessPreset, PresetDefinition> = {
  KIRANA: {
    default_mode: 'KIRANA',
    config_overlay: {
      inventory: { track_inventory: true, batch_tracking: false, negative_stock_allowed: true },
      pos: { enable_barcodes: true, quick_units: ['KG', 'G'] },
      credit: { enable_khata: true, enforcement_mode: 'ALLOW_WITH_APPROVAL' },
    },
    starter_products: [
      loose('LOOSE-CHINI', 'Sugar', 'चीनी', 45, 5),
      loose('LOOSE-ATTA', 'Wheat Flour', 'आटा', 38, 0),
      loose('LOOSE-CHAWAL', 'Basmati Rice', 'चावल', 85, 5),
      loose('LOOSE-DAAL-ARHAR', 'Arhar Dal', 'अरहर दाल', 140, 0),
      loose('LOOSE-DAAL-CHANA', 'Chana Dal', 'चना दाल', 95, 0),
      loose('LOOSE-NAMAK', 'Salt', 'नमक', 22, 0),
      loose('LOOSE-TEL-SARSO', 'Mustard Oil', 'सरसों तेल', 165, 5),
      loose('LOOSE-HALDI', 'Turmeric Powder', 'हल्दी', 320, 5),
      loose('LOOSE-MIRCH', 'Chilli Powder', 'लाल मिर्च', 380, 5),
      loose('LOOSE-CHAI', 'Tea Leaves', 'चाय पत्ती', 420, 5),
    ],
  },
  SALOON: {
    default_mode: 'RETAIL',
    config_overlay: {
      inventory: { track_inventory: false },
      pos: { enable_barcodes: false },
      credit: { enable_khata: true, enforcement_mode: 'WARN' },
      services: { enabled: true },
    },
    starter_products: [
      service('SVC-HAIRCUT-M', "Men's Haircut", 'पुरुष बाल कटवाना', 150),
      service('SVC-HAIRCUT-W', "Women's Haircut", 'महिला बाल कटवाना', 400),
      service('SVC-HAIRCOLOR', 'Hair Colour', 'बाल रंगना', 800),
      service('SVC-BEARD', 'Beard Trim', 'दाढ़ी ट्रिम', 80),
      service('SVC-MASSAGE', 'Head Massage', 'सिर की मालिश', 200),
      service('SVC-FACIAL', 'Facial', 'फेशियल', 600),
      service('SVC-MANICURE', 'Manicure', 'मैनीक्योर', 350),
      service('SVC-PEDICURE', 'Pedicure', 'पेडीक्योर', 450),
      service('SVC-THREADING', 'Threading', 'थ्रेडिंग', 50),
      service('SVC-SHAVE', 'Shave', 'शेविंग', 60),
    ],
  },
  DHABA: {
    default_mode: 'RETAIL',
    config_overlay: {
      inventory: { track_inventory: false },
      pos: { fast_dining_grid: true },
      credit: { enable_khata: true, enforcement_mode: 'WARN' },
    },
    starter_products: [
      service('MENU-DAL-MAKHANI', 'Dal Makhani', 'दाल मखनी', 180),
      service('MENU-NAAN-BUTTER', 'Butter Naan', 'बटर नान', 40),
      service('MENU-PANEER-TIKKA', 'Paneer Tikka', 'पनीर टिक्का', 220),
      service('MENU-ROTI-TANDOORI', 'Tandoori Roti', 'तंदूरी रोटी', 20),
      service('MENU-CHICKEN-CURRY', 'Chicken Curry', 'चिकन करी', 260),
      service('MENU-BIRYANI-VEG', 'Veg Biryani', 'वेज बिरयानी', 200),
      service('MENU-LASSI', 'Lassi', 'लस्सी', 60),
      service('MENU-RAITA', 'Raita', 'रायता', 50),
      service('MENU-PAPAD', 'Papad', 'पापड़', 25),
      service('MENU-GULAB-JAMUN', 'Gulab Jamun', 'गुलाब जामुन', 70),
    ],
  },
  REPAIR: {
    default_mode: 'RETAIL',
    config_overlay: {
      inventory: { track_inventory: true },
      services: { enabled: true },
    },
    starter_products: [
      piece('PART-SCREEN', 'Mobile Screen', 'मोबाइल स्क्रीन', 1500),
      piece('PART-BATTERY', 'Battery', 'बैटरी', 800),
      piece('PART-CHARGE-PORT', 'Charging Port', 'चार्जिंग पोर्ट', 350),
      piece('PART-BACK-COVER', 'Back Cover', 'बैक कवर', 250),
      piece('PART-SPEAKER', 'Speaker', 'स्पीकर', 300),
      service('LABOR-SCREEN', 'Screen Replacement (Labour)', 'स्क्रीन बदलना', 300),
      service('LABOR-BATTERY', 'Battery Replacement (Labour)', 'बैटरी बदलना', 200),
      service('LABOR-DIAGNOSTIC', 'Diagnostic Fee', 'जांच शुल्क', 100),
      service('LABOR-SOFTWARE', 'Software Update', 'सॉफ्टवेयर अपडेट', 250),
      service('LABOR-WATERDAMAGE', 'Water Damage Repair', 'पानी से नुकसान की मरम्मत', 600),
    ],
  },
  DISTRIBUTOR: {
    default_mode: 'KIRANA',
    config_overlay: {
      inventory: { track_inventory: true, batch_tracking: true },
      b2b: { tier_pricing_enabled: true },
      distributor: { carton_breakdown_enabled: true },
    },
    starter_products: [
      cartonGoods('DIST-RICE-25', 'Rice Bag (Carton of 1x25kg)', 'चावल बोरी', 1800, 1, 5),
      cartonGoods('DIST-SUGAR-50', 'Sugar Bag (Carton of 1x50kg)', 'चीनी बोरी', 2200, 1, 5),
      cartonGoods('DIST-OIL-15L', 'Cooking Oil (Carton of 15x1L)', 'खाना पकाने का तेल कार्टन', 2400, 15, 5),
      cartonGoods('DIST-SOAP-CTN', 'Soap (Carton of 72pcs)', 'साबुन कार्टन', 2880, 72, 18),
      cartonGoods('DIST-BISCUIT-CTN', 'Biscuit (Carton of 96pcs)', 'बिस्किट कार्टन', 1920, 96, 18),
      cartonGoods('DIST-SALT-CTN', 'Salt Bag (Carton of 1x50kg)', 'नमक बोरी', 900, 1, 0),
      cartonGoods('DIST-ATTA-CTN', 'Atta Bag (Carton of 1x50kg)', 'आटा बोरी', 1900, 1, 0),
      cartonGoods('DIST-TEA-CTN', 'Tea (Carton of 48pcs)', 'चाय कार्टन', 4800, 48, 5),
      cartonGoods('DIST-DETERGENT-CTN', 'Detergent (Carton of 24pcs)', 'डिटर्जेंट कार्टन', 3600, 24, 18),
      cartonGoods('DIST-NOODLES-CTN', 'Noodles (Carton of 60pcs)', 'नूडल्स कार्टन', 1200, 60, 18),
    ],
  },
};
