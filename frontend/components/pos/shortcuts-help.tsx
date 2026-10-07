'use client';

import { KEYBOARD_SHORTCUTS } from '@/lib/keyboard-shortcuts';
import { useLanguage } from '@/context/LanguageContext';

export function ShortcutsHelp({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useLanguage();
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-white/40 p-4" onClick={onClose}>
      <div
        className="w-full max-w-sm rounded-xl border border-slate-200 bg-slate-50 p-4 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="mb-3 text-sm font-semibold text-slate-900">{t('pos.keyboardShortcutsTitle')}</h2>
        <ul className="space-y-1.5">
          {KEYBOARD_SHORTCUTS.map((s) => (
            <li key={s.key} className="flex items-center justify-between text-sm">
              <span className="text-slate-500">{t(s.descriptionKey)}</span>
              <kbd className="rounded bg-slate-100 px-2 py-0.5 font-mono text-xs text-slate-800">{s.key}</kbd>
            </li>
          ))}
        </ul>
        <button
          type="button"
          onClick={onClose}
          className="mt-4 w-full rounded-md bg-slate-100 py-2 text-sm font-medium text-slate-800 hover:bg-slate-200"
        >
          {t('pos.close')}
        </button>
      </div>
    </div>
  );
}
