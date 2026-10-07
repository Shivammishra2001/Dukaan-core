/** API_CONTRACTS.md §6. Strapi-side paths (BFF exposes the /api/shifts/... paths from the contract). */
export default {
  routes: [
    // Not /shifts/active: the core router's GET /shifts/:id would claim that path.
    { method: 'GET', path: '/active-shift', handler: 'shift-lifecycle.active', config: { policies: ['global::require-service-token'] } },
    { method: 'POST', path: '/shifts/open', handler: 'shift-lifecycle.open', config: { policies: ['global::require-service-token'] } },
    { method: 'GET', path: '/shifts/:id/expected', handler: 'shift-lifecycle.expected', config: { policies: ['global::require-service-token'] } },
    { method: 'POST', path: '/shifts/:id/close', handler: 'shift-lifecycle.close', config: { policies: ['global::require-service-token'] } },
    { method: 'POST', path: '/shifts/:id/cash-movement', handler: 'shift-lifecycle.cashMovement', config: { policies: ['global::require-service-token'] } },
    { method: 'POST', path: '/shifts/:id/force-close', handler: 'shift-lifecycle.forceClose', config: { policies: ['global::require-service-token'] } },
  ],
};
