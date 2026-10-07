'use client';

import { useEffect, useRef, useState } from 'react';
import { Check, Palette } from 'lucide-react';
import { THEMES, useTheme } from '@/context/ThemeContext';
import { useLanguage } from '@/context/LanguageContext';

/** Theme Picker popover — 4 color presets, persisted to localStorage and applied via `data-theme` on <html> with no reload. Used in the sidebar profile footer and on /settings. */
export function ThemePicker({ variant = 'button' }: { variant?: 'button' | 'inline' }) {
  const { theme, setTheme } = useTheme();
  const { t } = useLanguage();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onClickAway(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onClickAway);
    return () => document.removeEventListener('mousedown', onClickAway);
  }, [open]);

  const activeSwatch = THEMES.find((th) => th.name === theme)?.swatch ?? '#2563eb';

  if (variant === 'inline') {
    return (
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {THEMES.map((th) => (
          <button
            key={th.name}
            type="button"
            onClick={() => setTheme(th.name)}
            className={`flex items-center gap-2 rounded-xl border px-3 py-2.5 text-left text-sm transition ${
              theme === th.name ? 'border-primary bg-primary/5 ring-2 ring-primary/20' : 'border-slate-200 hover:bg-slate-50'
            }`}
          >
            <span className="h-5 w-5 shrink-0 rounded-full border border-black/10" style={{ backgroundColor: th.swatch }} />
            <span className="min-w-0 flex-1 truncate font-medium text-slate-700">{t(`theme.${th.name}`)}</span>
            {theme === th.name && <Check size={15} className="shrink-0 text-primary" />}
          </button>
        ))}
      </div>
    );
  }

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label={t('common.theme')}
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-slate-200 text-slate-500 transition hover:bg-slate-50"
      >
        <Palette size={16} style={{ color: activeSwatch }} />
      </button>
      {open && (
        <div className="absolute bottom-full left-0 z-50 mb-2 w-56 rounded-xl border border-slate-200 bg-white p-2 shadow-xl">
          <p className="px-2 py-1 text-[10px] font-bold uppercase tracking-wide text-slate-400">{t('common.theme')}</p>
          {THEMES.map((th) => (
            <button
              key={th.name}
              type="button"
              onClick={() => {
                setTheme(th.name);
                setOpen(false);
              }}
              className={`flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left text-sm transition hover:bg-slate-50 ${theme === th.name ? 'font-semibold text-slate-900' : 'text-slate-600'}`}
            >
              <span className="h-4 w-4 shrink-0 rounded-full border border-black/10" style={{ backgroundColor: th.swatch }} />
              <span className="min-w-0 flex-1 truncate">{t(`theme.${th.name}`)}</span>
              {theme === th.name && <Check size={14} className="shrink-0 text-primary" />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
