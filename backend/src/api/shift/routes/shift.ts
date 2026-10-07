import { factories } from '@strapi/strapi';

/** Only reads via the Content API — all writes go through shift.service.ts / the custom lifecycle routes (shift-lifecycle.ts). */
export default factories.createCoreRouter('api::shift.shift', {
  only: ['find', 'findOne'],
});
