/**
 * The store the current POS session belongs to. Set by lib/session-scope.ts;
 * read by the outbox so offline orders are tagged with, and only replayed
 * under, the store they were rung up in. Kept dependency-free so the outbox
 * can import it without an import cycle through the Zustand stores.
 */
let activeStoreId: string | null = null;

export function getActiveStoreId(): string | null {
  return activeStoreId;
}

export function setActiveStoreId(storeId: string | null): void {
  activeStoreId = storeId;
}
