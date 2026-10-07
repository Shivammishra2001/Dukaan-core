import { factories } from '@strapi/strapi';
import { encryptField, normalizePhoneE164, hashPhone, last4 } from '../../customer/services/pii-crypto';
import { getSupplierBalance, listSupplierEntries, postSupplierEntryStandalone } from '../services/supplier-ledger';
import type { SupplierLedgerDirection, SupplierLedgerEntryType } from '../services/supplier-ledger';

/**
 * Same pattern as src/api/customer/controllers/customer.ts — no plaintext
 * `phone` attribute on the content type, encrypted here before it ever
 * reaches the Content API. Reuses customer's pii-crypto.ts directly (it was
 * never customer-specific) instead of duplicating the AES-256-GCM logic.
 */

function encryptContactFields(body: Record<string, any>) {
  const attrs: Record<string, any> = { ...body };
  const { phone } = body;
  delete attrs.phone;

  if (phone) {
    const e164 = normalizePhoneE164(phone);
    if (!e164) throw new Error('ERR_PHONE_INVALID: phone could not be normalised to E.164');
    attrs.phone_enc = encryptField(e164);
    attrs.phone_hash = hashPhone(e164);
    attrs.phone_last4 = last4(e164);
  }
  return attrs;
}

/**
 * Strapi's relation validator checks a to-one relation's raw value against
 * the target's numeric `id` column, not `documentId` — passing a store
 * documentId straight through (the only store identifier this app ever
 * hands to a client) fails with "relation(s) of type api::store.store ...
 * do not exist". Same fix as backend/src/api/product/controllers/product.ts.
 */
async function resolveStoreId(strapi: import('@strapi/strapi').Core.Strapi, attrs: Record<string, any>) {
  if (typeof attrs.store !== 'string') return attrs;
  const store = await strapi.db.query('api::store.store').findOne({ where: { documentId: attrs.store } });
  if (!store) throw new Error('ERR_STORE_NOT_FOUND: store documentId does not resolve to a store');
  return { ...attrs, store: store.id };
}

export default factories.createCoreController('api::supplier.supplier', ({ strapi }) => ({
  async create(ctx) {
    const { data } = ctx.request.body as { data: Record<string, any> };
    const sanitizedData = await resolveStoreId(strapi, encryptContactFields(data));
    const entry = await strapi.documents('api::supplier.supplier').create({ data: sanitizedData as any });
    ctx.body = { data: entry };
  },

  async update(ctx) {
    const { id } = ctx.params;
    const { data } = ctx.request.body as { data: Record<string, any> };
    const sanitizedData = await resolveStoreId(strapi, encryptContactFields(data));
    const entry = await strapi.documents('api::supplier.supplier').update({ documentId: id, data: sanitizedData as any });
    ctx.body = { data: entry };
  },

  /** GET /suppliers/:id/ledger-entries?limit=&beforeId= */
  async ledgerEntries(ctx) {
    const { id } = ctx.params;
    const supplier = await strapi.db.query('api::supplier.supplier').findOne({ where: { documentId: id } });
    if (!supplier) return ctx.notFound();

    const limit = ctx.query.limit ? Number(ctx.query.limit) : undefined;
    const beforeId = ctx.query.beforeId ? Number(ctx.query.beforeId) : undefined;
    const entries = await listSupplierEntries(supplier.id, { limit, beforeId });
    const balance = await getSupplierBalance(supplier.id);
    ctx.body = { data: entries, meta: { current_balance_paise: balance } };
  },

  /** POST /suppliers/:id/ledger-entries — e.g. a manual PAYMENT_MADE entry. */
  async postLedgerEntry(ctx) {
    const { id } = ctx.params;
    // `store` is a relation — db.query() only returns it when populated, otherwise
    // supplier.store is undefined and the ledger insert's NOT NULL store_id fails.
    const supplier = await strapi.db.query('api::supplier.supplier').findOne({ where: { documentId: id }, populate: ['store'] });
    if (!supplier) return ctx.notFound();

    const body = ctx.request.body as {
      entry_type: SupplierLedgerEntryType;
      direction: SupplierLedgerDirection;
      amount_paise: number;
      entry_date?: string;
      reference_type?: string;
      reference_id?: number;
      note?: string;
    };

    const row = await postSupplierEntryStandalone({
      storeId: supplier.store.id,
      supplierId: supplier.id,
      entryType: body.entry_type,
      direction: body.direction,
      amountPaise: body.amount_paise,
      entryDate: body.entry_date ?? new Date().toISOString().slice(0, 10),
      referenceType: body.reference_type,
      referenceId: body.reference_id,
      note: body.note,
      createdById: ctx.state.user?.id,
    });

    ctx.body = { data: row };
  },
}));
