/**
 * TASKS_BREAKDOWN.md AC-6.x requires the RETAIL journey to be completable
 * "mouse-free, using F-key shortcuts only" but the docs don't pin exact key
 * bindings — this is the concrete assignment for that requirement,
 * centralised so the hint bar / help overlay and the actual hotkey wiring
 * in app/pos/page.tsx never drift apart.
 */
export const KEYBOARD_SHORTCUTS = [
  { key: 'F1', description: 'Focus barcode / search box', descriptionKey: 'shortcuts.f1' },
  { key: 'F2', description: 'Quick Grid tab', descriptionKey: 'shortcuts.f2' },
  { key: 'F3', description: 'Search & Catalog tab', descriptionKey: 'shortcuts.f3' },
  { key: 'F4', description: 'Checkout / Pay', descriptionKey: 'shortcuts.f4' },
  { key: 'F6', description: 'Cart discount', descriptionKey: 'shortcuts.f6' },
  { key: 'F8', description: 'Park cart', descriptionKey: 'shortcuts.f8' },
  { key: 'F9', description: 'Attach customer', descriptionKey: 'shortcuts.f9' },
  { key: 'Esc', description: 'Close dialog', descriptionKey: 'shortcuts.esc' },
  { key: '?', description: 'Toggle this help', descriptionKey: 'shortcuts.help' },
] as const;
