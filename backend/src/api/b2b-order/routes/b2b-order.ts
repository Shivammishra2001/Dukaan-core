import { factories } from '@strapi/strapi';

/** Read-only via the Content API — all writes happen inside b2b-dispatch.service.ts's Knex transactions. */
export default factories.createCoreRouter('api::b2b-order.b2b-order', {
  only: ['find', 'findOne'],
});
