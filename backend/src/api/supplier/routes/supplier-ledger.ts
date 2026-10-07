/** Separate file so Strapi merges it with the plain core router in supplier.ts — see customer/routes/customer-ledger.ts for why. */
export default {
  routes: [
    { method: 'GET', path: '/suppliers/:id/ledger-entries', handler: 'supplier.ledgerEntries', config: { policies: [] } },
    { method: 'POST', path: '/suppliers/:id/ledger-entries', handler: 'supplier.postLedgerEntry', config: { policies: [] } },
  ],
};
