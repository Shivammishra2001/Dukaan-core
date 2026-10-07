import { useEffect, useRef } from 'react';

/**
 * SYSTEM_ARCHITECTURE.md §6.1: keyboard-wedge scanner detection. A burst of
 * >= 6 characters arriving with inter-key gaps < 30ms and terminated by
 * Enter is classified as a scan, not typing; the buffer is consumed and
 * only that terminating Enter is preventDefault'ed, so normal typing
 * (including in other inputs) is untouched. Focus never needs to be in a
 * specific field — this listens in the capture phase on window.
 */
const MAX_INTER_KEY_GAP_MS = 30;
const MIN_SCAN_LENGTH = 6;

export function useBarcodeScanner(onScan: (code: string) => void, enabled = true) {
  const bufferRef = useRef('');
  const lastKeyAtRef = useRef(0);

  useEffect(() => {
    if (!enabled) return;

    function handleKeyDown(e: KeyboardEvent) {
      const now = performance.now();
      const gap = now - lastKeyAtRef.current;
      lastKeyAtRef.current = now;

      if (e.key === 'Enter') {
        const buffer = bufferRef.current;
        bufferRef.current = '';
        if (buffer.length >= MIN_SCAN_LENGTH) {
          e.preventDefault();
          onScan(buffer);
        }
        return;
      }

      if (e.key.length !== 1) return; // ignore Shift, Tab, arrow keys, etc.

      bufferRef.current = gap > MAX_INTER_KEY_GAP_MS ? e.key : bufferRef.current + e.key;
    }

    window.addEventListener('keydown', handleKeyDown, true);
    return () => window.removeEventListener('keydown', handleKeyDown, true);
  }, [onScan, enabled]);
}
