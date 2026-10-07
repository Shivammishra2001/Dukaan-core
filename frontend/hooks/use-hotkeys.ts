import { useEffect } from 'react';

type HotkeyHandler = (e: KeyboardEvent) => void;

/** lib/keyboard-shortcuts.ts documents the bindings this is used to wire up. */
export function useHotkeys(map: Record<string, HotkeyHandler>, enabled = true) {
  useEffect(() => {
    if (!enabled) return;
    function handleKeyDown(e: KeyboardEvent) {
      const handler = map[e.key];
      if (handler) {
        e.preventDefault();
        handler(e);
      }
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [map, enabled]);
}
