import type { Core } from '@strapi/strapi';

declare const strapi: Core.Strapi;

/**
 * REQUIREMENTS.md §1.2 canonical conversion table + Rule UC-1: "KG→G and
 * L→ML factors are system constants and MUST NOT be editable per product."
 * PACKET/CARTON/BORI/CRATE/QUINTAL are per-product and only need to be
 * positive (enforced by the ck_uc_factor_positive DB CHECK).
 */
const FIXED_FACTORS: Record<string, Record<string, number>> = {
  G: { G: 1, KG: 1000, QUINTAL: 100000 },
  ML: { ML: 1, L: 1000 },
  PCS: { PCS: 1, DOZEN: 12 },
};

const VALID_UNITS_FOR_BASE: Record<string, string[]> = {
  G: ['G', 'KG', 'QUINTAL', 'PACKET', 'BORI', 'CARTON'],
  ML: ['ML', 'L', 'PACKET', 'CRATE'],
  PCS: ['PCS', 'DOZEN', 'PACKET', 'CARTON'],
};

async function validate(data: any, productId: number | string) {
  const product = await strapi.db.query('api::product.product').findOne({
    where: { id: productId },
    select: ['id', 'base_unit'],
  });
  if (!product) {
    throw new Error(`ERR_STORE_MISMATCH: product ${productId} not found`);
  }

  const allowedUnits = VALID_UNITS_FOR_BASE[product.base_unit] ?? [];
  if (data.unit_code && !allowedUnits.includes(data.unit_code)) {
    throw new Error(
      `ERR_UNIT_NOT_CONVERTIBLE: unit ${data.unit_code} is not valid for base unit ${product.base_unit}`
    );
  }

  const fixed = FIXED_FACTORS[product.base_unit]?.[data.unit_code];
  if (fixed !== undefined && data.factor_to_base !== undefined && Number(data.factor_to_base) !== fixed) {
    throw new Error(
      `UC_1_VIOLATION: ${data.unit_code} factor_to_base is a system constant (${fixed}) for base unit ${product.base_unit} and cannot be overridden`
    );
  }
}

export default {
  async beforeCreate(event: any) {
    const { data } = event.params;
    await validate(data, data.product);
  },

  async beforeUpdate(event: any) {
    const { data, where } = event.params;
    if (data.unit_code !== undefined || data.factor_to_base !== undefined) {
      const existing = await strapi.db.query('api::unit-conversion.unit-conversion').findOne({ where });
      await validate(
        { unit_code: data.unit_code ?? existing?.unit_code, factor_to_base: data.factor_to_base ?? existing?.factor_to_base },
        existing?.product
      );
    }
  },
};
