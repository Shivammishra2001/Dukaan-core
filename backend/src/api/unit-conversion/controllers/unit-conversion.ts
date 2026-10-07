import { factories } from '@strapi/strapi';

/**
 * Strapi's relation validator checks a to-one relation's raw value against
 * the target's numeric `id` column, not `documentId` — passing a store or
 * product documentId straight through (the only identifiers this app ever
 * hands to a client) fails with "relation(s) of type ... do not exist".
 * Same fix as backend/src/api/product/controllers/product.ts, applied to
 * both relations this content type carries.
 */
export default factories.createCoreController('api::unit-conversion.unit-conversion', ({ strapi }) => ({
  async create(ctx) {
    const body = ctx.request.body as { data?: Record<string, unknown> };
    const storeDocumentId = body?.data?.store;
    const productDocumentId = body?.data?.product;

    if (typeof storeDocumentId === 'string') {
      const store = await strapi.db.query('api::store.store').findOne({ where: { documentId: storeDocumentId } });
      if (!store) return ctx.badRequest('Invalid store');
      body.data!.store = store.id;
    }
    if (typeof productDocumentId === 'string') {
      const product = await strapi.db.query('api::product.product').findOne({ where: { documentId: productDocumentId } });
      if (!product) return ctx.badRequest('Invalid product');
      body.data!.product = product.id;
    }

    return super.create(ctx);
  },
}));
