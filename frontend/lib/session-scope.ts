import { usePosStore } from '@/stores/pos-store';
import { useShiftStore } from '@/stores/shift-store';
import { posDb } from '@/lib/db/pos-db';
import { setActiveStoreId } from '@/lib/sync/active-store';

/**
 * Keeps POS client state bound to one (store, user) session. Logout/login is
 * a client-side navigation, so the in-memory Zustand stores (cart, parked
 * carts, open shift) survive it — and a cart or shift left over from another
 * store makes every checkout 403 with ERR_STORE_MISMATCH. The last scope is
 * also remembered in localStorage so a fresh tab can tell when the device
 * changed hands and drop the per-device IndexedDB caches.
 *
 * Offline outbox orders are never deleted here (they are real sales): each
 * one is tagged with its store and only replays under that store's session
 * (see lib/sync/outbox-sync.ts).
 */

export interface SessionScope {
  storeId: string;
  userId: string;
}

const SCOPE_STORAGE_KEY = 'dukaan_pos_scope';

let activeScope: SessionScope | null = null;

function readStoredScope(): SessionScope | null {
  try {
    const raw = window.localStorage.getItem(SCOPE_STORAGE_KEY);
    return raw ? (JSON.parse(raw) as SessionScope) : null;
  } catch {
    return null;
  }
}

function sameScope(a: SessionScope | null, b: SessionScope | null): boolean {
  return !!a && !!b && a.storeId === b.storeId && a.userId === b.userId;
}

function resetInMemoryPosState() {
  usePosStore.getState().resetForSession();
  useShiftStore.getState().reset();
}

/**
 * Call as soon as the verified session (GET /api/auth/me) is known. Clears
 * the cart, parked carts and shift when a different store/user was active in
 * this tab, and the IndexedDB catalogue/customer caches when the scope
 * differs from the last session on this device.
 */
export async function ensureSessionScope(scope: SessionScope): Promise<void> {
  if (sameScope(activeScope, scope)) return;

  const stored = readStoredScope();
  // A different scope was active in this tab (e.g. logged in again without
  // logging out): its cart/shift reference the other store. With no active
  // scope, memory is either a fresh tab or already cleared by clearSessionScope().
  if (activeScope) resetInMemoryPosState();
  activeScope = scope;
  setActiveStoreId(scope.storeId);
  try {
    window.localStorage.setItem(SCOPE_STORAGE_KEY, JSON.stringify(scope));
  } catch {
    /* localStorage unavailable (private mode) — in-memory reset above still applies */
  }

  if (stored && !sameScope(stored, scope) && posDb) {
    await Promise.all([posDb.local_catalog.clear(), posDb.customers_cache.clear()]).catch(() => undefined);
  }
}

/** Call on logout, before navigating away. */
export function clearSessionScope(): void {
  resetInMemoryPosState();
  activeScope = null;
  setActiveStoreId(null);
}
