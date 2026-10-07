'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

export type ThemeName = 'blue' | 'green' | 'indigo' | 'amber';

export const THEMES: Array<{ name: ThemeName; label: string; swatch: string }> = [
  { name: 'blue', label: 'Professional Blue', swatch: '#2563eb' },
  { name: 'green', label: 'Kirana Forest Green', swatch: '#15803d' },
  { name: 'indigo', label: 'Modern Slate Indigo', swatch: '#4f46e5' },
  { name: 'amber', label: 'Mustard Enterprise', swatch: '#d97706' },
];

const STORAGE_KEY = 'dukaan_theme';
const DEFAULT_THEME: ThemeName = 'blue';

interface ThemeContextValue {
  theme: ThemeName;
  setTheme: (theme: ThemeName) => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

/**
 * Same hydration-safe shape as LanguageContext: renders `DEFAULT_THEME` on
 * the server and first client paint, then reads localStorage in an effect.
 * `data-theme` is applied to `document.documentElement` (not component
 * state) so app/globals.css's `:root[data-theme="..."]` CSS variable
 * overrides apply instantly, with no full-page reload.
 */
export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = useState<ThemeName>(DEFAULT_THEME);

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(STORAGE_KEY);
      if (stored === 'blue' || stored === 'green' || stored === 'indigo' || stored === 'amber') setThemeState(stored);
    } catch {
      /* localStorage unavailable (private mode) — keep the default */
    }
  }, []);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
  }, [theme]);

  const setTheme = useCallback((next: ThemeName) => {
    setThemeState(next);
    try {
      window.localStorage.setItem(STORAGE_KEY, next);
    } catch {
      /* ignore */
    }
  }, []);

  const value = useMemo(() => ({ theme, setTheme }), [theme, setTheme]);

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme() must be used inside a <ThemeProvider>');
  return ctx;
}
