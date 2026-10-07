/**
 * API_CONTRACTS.md §2: "Strapi: POST /api/checkout". Registered as a plain
 * custom route (no content-type) since checkout isn't CRUD.
 */
export default {
  routes: [
    {
      method: 'POST',
      path: '/checkout',
      handler: 'checkout.create',
      config: { policies: ['global::require-service-token'] },
    },
  ],
};
