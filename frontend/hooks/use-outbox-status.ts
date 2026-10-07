import { useEffect, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { posDb } from '@/lib/db/pos-db';

/** Drives the "Offline - X orders pending sync" badge (top bar). */
export function useOutboxStatus() {
  // Always starts "online": SSR has no connectivity info, and (as of Node
  // 20+) Node ships a minimal global `navigator` with no `.onLine` at all,
  // so feature-detecting it during the initial render is unreliable —
  // this corrects itself from the real browser value on mount instead.
  const [online, setOnline] = useState(true);

  useEffect(() => {
    if (typeof navigator !== 'undefined' && typeof navigator.onLine === 'boolean') {
      setOnline(navigator.onLine);
    }
    const goOnline = () => setOnline(true);
    const goOffline = () => setOnline(false);
    window.addEventListener('online', goOnline);
    window.addEventListener('offline', goOffline);
    return () => {
      window.removeEventListener('online', goOnline);
      window.removeEventListener('offline', goOffline);
    };
  }, []);

  const pendingCount =
    useLiveQuery(async () => {
      if (!posDb) return 0;
      return posDb.offline_orders.where('status').anyOf(['PENDING', 'FAILED', 'INFLIGHT']).count();
    }, []) ?? 0;

  return { online, pendingCount };
}
