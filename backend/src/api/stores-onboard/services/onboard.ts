import type { Core } from '@strapi/strapi';
import type { Knex } from 'knex';
import { AppError } from '../../../services/errors';
import { strapiRowStamps } from '../../../services/strapi-row';
import { resolveInvoicePrefix } from '../../../services/invoice-prefix';
import { PRESETS, type BusinessPreset } from './presets';

declare const strapi: Core.Strapi;

/**
 * Milestone 4 addition (`POST /api/stores/onboard`, not in API_CONTRACTS.md
 * — see presets.ts's header comment for the scope note). Same pattern as
 * checkout.service.ts / shift-lifecycle.ts: one Knex transaction, writes
 * bypass the Document Service (Rule BE-2 / ADR-04) — which also means the
 * product/unit-conversion lifecycle hooks from Milestone 1 don't fire here,
 * so this manually does what they'd normally do (search_text, the Rule UC-2
 * base-unit conversion row). The DB-level UC-A trigger still applies
 * regardless of insert path, so that invariant is never at risk.
 */

export interface OnboardStoreInput {
  tenantDocumentId?: string;
  tenantName?: string;
  preset: BusinessPreset;
  store: {
    code: string;
    name: string;
    name_local?: string;
    state_code: string;
    city?: string;
    phone?: string;
    gstin?: string;
  };
}

function buildSearchText(name: string, nameLocal: string | undefined, sku: string): string {
  return [name, nameLocal, sku].filter(Boolean).join(' ');
}

export async function onboardStore(input: OnboardStoreInput) {
  return strapi.db.connection.transaction((trx: Knex.Transaction) => onboardStoreCore(trx, input));
}

/**
 * The transaction body, factored out so callers that already hold a Knex
 * transaction (e.g. src/api/auth/services/auth.ts's registerCompany, which
 * also needs to create the app_user + app_user_store_role row atomically
 * alongside the tenant/store/catalogue) can compose it into their own
 * transaction instead of nesting a second one. `onboardStore` above is the
 * original, unchanged entry point for the standalone /api/stores/onboard route.
 */
export async function onboardStoreCore(trx: Knex.Transaction, input: OnboardStoreInput) {
  const preset = PRESETS[input.preset];
  if (!preset) {
    throw new AppError('ERR_VALIDATION', 400, `Unknown preset "${input.preset}" — expected one of ${Object.keys(PRESETS).join(', ')}`);
  }
  if (!input.store?.code || !input.store?.name || !input.store?.state_code) {
    throw new AppError('ERR_VALIDATION', 400, 'store.code, store.name and store.state_code are required');
  }

  {
    let tenant: Record<string, any>;
    if (input.tenantDocumentId) {
      const found = await trx('tenants').where({ document_id: input.tenantDocumentId }).first();
      if (!found) throw new AppError('ERR_NOT_FOUND', 404, `Tenant ${input.tenantDocumentId} not found`);
      tenant = found;
    } else {
      const [created] = await trx('tenants')
        .insert({ ...strapiRowStamps(), name: input.tenantName ?? input.store.name, plan: 'STANDARD', is_active: true })
        .returning('*');
      tenant = created;
    }

    const existingCode = await trx('stores').where({ tenant_id: tenant.id, code: input.store.code }).first();
    if (existingCode) {
      throw new AppError('ERR_STORE_CODE_TAKEN', 422, `Store code "${input.store.code}" is already used by this tenant`);
    }

    const [store] = await trx('stores')
      .insert({
        ...strapiRowStamps(),
        tenant_id: tenant.id,
        code: input.store.code,
        name: input.store.name,
        name_local: input.store.name_local ?? null,
        default_mode: preset.default_mode,
        business_preset: input.preset,
        state_code: input.store.state_code,
        city: input.store.city ?? null,
        phone: input.store.phone ?? null,
        gstin: input.store.gstin ?? null,
        // Raw insert: schema.json's default doesn't apply, so set it explicitly.
        invoice_prefix: resolveInvoicePrefix({ name: input.store.name, code: input.store.code }),
        config: JSON.stringify(preset.config_overlay),
        is_active: true,
      })
      .returning('*');

    const [counter] = await trx('counters')
      .insert({ ...strapiRowStamps(), store_id: store.id, code: 'C1', name: 'Counter 1', is_active: true })
      .returning('*');

    let seededConversions = 0;
    for (const p of preset.starter_products) {
      const [product] = await trx('products')
        .insert({
          ...strapiRowStamps(),
          store_id: store.id,
          sku: p.sku,
          name: p.name,
          name_local: p.name_local ?? null,
          search_text: buildSearchText(p.name, p.name_local, p.sku),
          base_unit: p.base_unit,
          is_service: p.is_service,
          allow_fractional: p.allow_fractional,
          quantity_precision: p.quantity_precision,
          default_sale_unit: p.default_sale_unit,
          default_purchase_unit: p.default_purchase_unit,
          pricing_unit: p.pricing_unit,
          requires_quantity_prompt: false,
          mrp_paise: p.mrp_paise ?? null,
          sell_rate_paise: p.sell_rate_paise,
          gst_rate: p.gst_rate,
          cess_rate: 0,
          tax_inclusive: p.tax_inclusive,
          discount_exempt: false,
          track_batches: false,
          track_expiry: false,
          sales_rank: 0,
          is_active: true,
        })
        .returning('*');

      // Rule UC-2: every product needs a base-unit row with factor_to_base = 1.
      await trx('unit_conversions').insert({
        ...strapiRowStamps(),
        store_id: store.id,
        product_id: product.id,
        unit_code: p.base_unit,
        factor_to_base: 1,
        is_sale_unit: true,
        is_purchase_unit: true,
        sort_order: 0,
      });
      seededConversions += 1;

      for (const [i, conv] of (p.extra_conversions ?? []).entries()) {
        await trx('unit_conversions').insert({
          ...strapiRowStamps(),
          store_id: store.id,
          product_id: product.id,
          unit_code: conv.unit_code,
          factor_to_base: conv.factor_to_base,
          is_sale_unit: conv.is_sale_unit,
          is_purchase_unit: conv.is_purchase_unit,
          sort_order: i + 1,
        });
        seededConversions += 1;
      }
    }

    return { store, tenant, counter, seededProducts: preset.starter_products.length, seededConversions };
  }
}
