import { factories } from '@strapi/strapi';

/**
 * Strapi's relation validator (entity-validator's checkRelationsExist)
 * checks a to-one relation's raw value against the target's numeric `id`
 * column, not `documentId` — passing a store documentId straight through
 * (the convention this codebase uses everywhere else, since documentId is
 * the only store identifier ever handed to a client) fails with
 * "relation(s) of type api::store.store ... do not exist" because no store
 * row has that UUID as its numeric id. Resolve it to the numeric id here,
 * same fix customer/supplier's controllers will need if they ever exercise
 * their own `create` from a real client.
 */
export default factories.createCoreController('api::product.product', ({ strapi }) => ({
  async create(ctx) {
    const body = ctx.request.body as { data?: Record<string, unknown> };
    const storeDocumentId = body?.data?.store;
    if (typeof storeDocumentId === 'string') {
      const store = await strapi.db.query('api::store.store').findOne({ where: { documentId: storeDocumentId } });
      if (!store) return ctx.badRequest('Invalid store');
      body.data!.store = store.id;
    }
    return super.create(ctx);
  },
}));
