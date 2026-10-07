/** Saman & Rates bulk import. Reached only through the BFF (service token + session-derived X-Store-Id), same as checkout/shift routes. */
export default {
  routes: [{ method: 'POST', path: '/product-import', handler: 'product-import.create', config: { policies: ['global::require-service-token'] } }],
};
