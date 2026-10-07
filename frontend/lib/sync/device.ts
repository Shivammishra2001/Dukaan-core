/**
 * REQUIREMENTS.md OFF-003: offline bills get a provisional number
 * `{STORE_CODE}-OFF-{device_seq}`. No device-registration flow exists yet
 * (that's real auth/device management, out of scope here), so this uses a
 * per-browser-profile random device id and a localStorage sequence counter
 * — good enough for a single-tab POS terminal, not for concurrent tabs.
 */

const DEVICE_ID_KEY = 'dukaan.device_id';
const OFFLINE_SEQ_KEY = 'dukaan.offline_seq';

export function getDeviceId(): string {
  if (typeof window === 'undefined') return 'ssr';
  let id = localStorage.getItem(DEVICE_ID_KEY);
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem(DEVICE_ID_KEY, id);
  }
  return id;
}

export function nextOfflineSeq(): number {
  if (typeof window === 'undefined') return 0;
  const current = Number(localStorage.getItem(OFFLINE_SEQ_KEY) ?? '0');
  const next = current + 1;
  localStorage.setItem(OFFLINE_SEQ_KEY, String(next));
  return next;
}

export function buildProvisionalNo(storeCode: string): string {
  return `${storeCode}-OFF-${nextOfflineSeq()}`;
}

/**
 * Robust connectivity check. Node 20+ ships a minimal global `navigator`
 * with no `.onLine` property, so a bare `typeof navigator === 'undefined'`
 * guard doesn't catch server-side execution — this checks the property's
 * actual type instead, and only trusts it as a real browser signal.
 */
export function isOnline(): boolean {
  if (typeof navigator === 'undefined' || typeof navigator.onLine !== 'boolean') return true;
  return navigator.onLine;
}
