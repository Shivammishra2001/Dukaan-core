import { factories } from '@strapi/strapi';

/** Read-only via the Content API — all writes happen inside purchase-inward.service.ts's Knex transaction (mirrors order/routes/order.ts). */
export default factories.createCoreRouter('api::purchase-bill.purchase-bill', {
  only: ['find', 'findOne'],
});
