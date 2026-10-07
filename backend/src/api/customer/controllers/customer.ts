import { factories } from '@strapi/strapi';
import { encryptField, normalizePhoneE164, hashPhone, last4 } from '../services/pii-crypto';
import { postEntryStandalone, listEntries, getBalance } from '../services/ledger';
import type { LedgerDirection, LedgerEntryType, LedgerReferenceType } from '../services/ledger';

/**
 * customer.schema.json has no plaintext phone/address attribute by design
 * (see its `info.description`). Plaintext only ever exists on the wire —
 * these overrides encrypt it before anything reaches the Content API /
 * database. Standard `find`/`findOne`/`delete` are left to the core
 * controller; only the write paths and the custom ledger endpoints are
 * overridden here.
 */

function encryptContactFields(body: Record<string, any>) {
  const attrs: Record<string, any> = { ...body };
  const { phone, address } = body;
  delete attrs.phone;
  delete attrs.address;

  if (phone) {
    const e164 = normalizePhoneE164(phone);
    if (!e164) {
      throw new Error('ERR_PHONE_INVALID: phone could not be normalised to E.164');
    }
    attrs.phone_enc = encryptField(e164);
    attrs.phone_hash = hashPhone(e164);
    attrs.phone_last4 = last4(e164);
  }
  if (address) {
    attrs.address_enc = encryptField(address);
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

export default factories.createCoreController('api::customer.customer', ({ strapi }) => ({
  async create(ctx) {
    const { data } = ctx.request.body as { data: Record<string, any> };
    const sanitizedData = await resolveStoreId(strapi, encryptContactFields(data));
    const entry = await strapi.documents('api::customer.customer').create({ data: sanitizedData as any });
    ctx.body = { data: entry };
  },

  async update(ctx) {
    const { id } = ctx.params;
    const { data } = ctx.request.body as { data: Record<string, any> };
    const sanitizedData = await resolveStoreId(strapi, encryptContactFields(data));
    const entry = await strapi.documents('api::customer.customer').update({
      documentId: id,
      data: sanitizedData as any,
    });
    ctx.body = { data: entry };
  },

  /** GET /customers/:id/ledger-entries?limit=&beforeId= */
  async ledgerEntries(ctx) {
    const { id } = ctx.params;
    const customer = await strapi.db.query('api::customer.customer').findOne({ where: { documentId: id } });
    if (!customer) return ctx.notFound();

    const limit = ctx.query.limit ? Number(ctx.query.limit) : undefined;
    const beforeId = ctx.query.beforeId ? Number(ctx.query.beforeId) : undefined;
    const entries = await listEntries(customer.id, { limit, beforeId });
    const balance = await getBalance(customer.id);
    ctx.body = { data: entries, meta: { current_balance_paise: balance } };
  },

  /**
   * POST /customers/:id/ledger-entries
   * body: { entry_type, direction, amount_paise, entry_date, reference_type?, reference_id?, note? }
   * REQUIREMENTS.md §4.1 — routes straight to ledger.service.postEntry, which
   * owns the locking, running-balance computation and cached-mirror update.
   */
  async postLedgerEntry(ctx) {
    const { id } = ctx.params;
    // `store` is a relation — db.query() only returns it when populated, otherwise
    // customer.store is undefined and the ledger insert's NOT NULL store_id fails.
    const customer = await strapi.db.query('api::customer.customer').findOne({ where: { documentId: id }, populate: ['store'] });
    if (!customer) return ctx.notFound();

    const body = ctx.request.body as {
      entry_type: LedgerEntryType;
      direction: LedgerDirection;
      amount_paise: number;
      entry_date?: string;
      reference_type?: LedgerReferenceType;
      reference_id?: number;
      note?: string;
    };

    const row = await postEntryStandalone({
      storeId: customer.store.id,
      customerId: customer.id,
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
