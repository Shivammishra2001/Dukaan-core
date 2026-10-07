export default {
  routes: [
    { method: 'POST', path: '/stores/onboard', handler: 'stores-onboard.onboard', config: { policies: [], auth: false } },
  ],
};
