/**
 * `POST /b2b/orders/dispatch` is the exact path the Milestone 6 brief
 * names for "the dispatch workflow" — the BOOKED -> DISPATCHED transition
 * specifically. The other three status/aggregation actions it also
 * describes (book, deliver, the loading sheet) get sibling paths.
 */
export default {
  routes: [
    { method: 'POST', path: '/b2b/orders/book', handler: 'b2b-dispatch.book', config: { policies: ['global::require-service-token'] } },
    { method: 'POST', path: '/b2b/orders/dispatch', handler: 'b2b-dispatch.dispatch', config: { policies: ['global::require-service-token'] } },
    { method: 'POST', path: '/b2b/orders/deliver', handler: 'b2b-dispatch.deliver', config: { policies: ['global::require-service-token'] } },
    { method: 'GET', path: '/b2b/dispatch/loading-sheet', handler: 'b2b-dispatch.loadingSheet', config: { policies: ['global::require-service-token'] } },
  ],
};
