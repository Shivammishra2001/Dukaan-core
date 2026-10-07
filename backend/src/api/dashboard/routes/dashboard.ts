/** Owner dashboard aggregates. BFF-only: store scope comes from the session-derived X-Store-Id header. */
export default {
  routes: [
    {
      method: 'GET',
      path: '/dashboard-summary',
      handler: 'dashboard.summary',
      config: { policies: ['global::require-service-token'] },
    },
  ],
};
