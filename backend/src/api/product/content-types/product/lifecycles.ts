import type { Core } from '@strapi/strapi';

declare const strapi: Core.Strapi;

/**
 * Very small transliteration index for Hindi digit-free common grocery
 * terms (REQUIREMENTS.md §9: "chini" -> "चीनी"). This is a seed list, not
 * a general transliterator — extend as the catalogue grows.
 */
const TRANSLIT_SEED: Record<string, string> = {
  'चीनी': 'chini',
  'चावल': 'chawal',
  'आटा': 'atta',
  'दाल': 'dal',
  'तेल': 'tel',
  'नमक': 'namak',
  'साबुन': 'sabun',
  'दूध': 'doodh',
};

function buildSearchText(name: string, nameLocal: string | null | undefined, sku: string): string {
  const translit = nameLocal ? TRANSLIT_SEED[nameLocal.trim()] : undefined;
  return [name, nameLocal, translit, sku].filter(Boolean).join(' ');
}

export default {
  async beforeCreate(event: any) {
    const { data } = event.params;
    data.search_text = buildSearchText(data.name, data.name_local, data.sku);
  },

  async beforeUpdate(event: any) {
    const { data, where } = event.params;
    if (data.name !== undefined || data.name_local !== undefined || data.sku !== undefined) {
      const existing = await strapi.db.query('api::product.product').findOne({ where });
      data.search_text = buildSearchText(
        data.name ?? existing?.name,
        data.name_local ?? existing?.name_local,
        data.sku ?? existing?.sku
      );
    }
  },

  /**
   * Rule UC-2: "A product MUST have a UnitConversion row for its base unit
   * with factor_to_base = 1. Seeded automatically on product create."
   * The DB trigger from 0005_unit_conversions_constraints.js then guards
   * this row against deletion or mutation away from factor_to_base = 1.
   */
  async afterCreate(event: any) {
    const { result } = event;
    await strapi.db.query('api::unit-conversion.unit-conversion').create({
      data: {
        store: result.store,
        product: result.id,
        unit_code: result.base_unit,
        factor_to_base: 1,
        is_sale_unit: true,
        is_purchase_unit: true,
        sort_order: 0,
      },
    });
  },
};
