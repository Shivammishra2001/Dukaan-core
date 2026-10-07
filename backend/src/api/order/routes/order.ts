import { factories } from '@strapi/strapi';

/**
 * DATABASE_SCHEMA.md §9.1: orders are "read-only in admin, disableCreate
 * policy" — all writes happen inside checkout.service's Knex transaction
 * (Rule BE-2 / ADR-04), never through the Document Service, so only the
 * read routes (find/findOne) are registered at all.
 */
export default factories.createCoreRouter('api::order.order', {
  only: ['find', 'findOne'],
});
