/** The exact path Milestone 6 asked for (API_CONTRACTS.md's own GRN concept is `/api/inventory/grn` — this is that same transaction, at the brief's requested path). */
export default {
  routes: [{ method: 'POST', path: '/purchases/inward', handler: 'purchase-inward.create', config: { policies: ['global::require-service-token'] } }],
};
