/**
 * Strapi loads every file in an api's `routes/` folder and merges their
 * `routes` arrays, so these custom ledger routes live alongside the plain
 * core router in customer.ts rather than trying to splice into it directly
 * (spreading a core router's `routes` getter at module-eval time — before
 * content types are registered — throws TypeError: Cannot read properties
 * of undefined (reading 'kind')).
 */
export default {
  routes: [
    {
      method: 'GET',
      path: '/customers/:id/ledger-entries',
      handler: 'customer.ledgerEntries',
      config: { policies: [] },
    },
    {
      method: 'POST',
      path: '/customers/:id/ledger-entries',
      handler: 'customer.postLedgerEntry',
      config: { policies: [] },
    },
  ],
};
