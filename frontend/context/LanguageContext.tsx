'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { TRANSLATIONS, type Language } from '@/lib/translations';

const STORAGE_KEY = 'dukaan_language';
const DEFAULT_LANGUAGE: Language = 'en';

interface LanguageContextValue {
  language: Language;
  setLanguage: (lang: Language) => void;
  /** Looks up `key` in the active language, falling back to `en`, then to the raw key itself (never throws on a missing key). */
  t: (key: string) => string;
}

const LanguageContext = createContext<LanguageContextValue | null>(null);

/**
 * Hydration-safe: renders `DEFAULT_LANGUAGE` on both the server and the
 * client's first paint (so markup matches and React never warns about a
 * hydration mismatch), then reads the persisted choice from localStorage in
 * an effect and re-renders once mounted — the standard SSR-safe pattern for
 * client-only persisted state.
 */
export function LanguageProvider({ children }: { children: React.ReactNode }) {
  const [language, setLanguageState] = useState<Language>(DEFAULT_LANGUAGE);

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(STORAGE_KEY);
      if (stored === 'en' || stored === 'hi' || stored === 'hi-Latn') setLanguageState(stored);
    } catch {
      /* localStorage unavailable (private mode) — keep the default */
    }
  }, []);

  useEffect(() => {
    document.documentElement.lang = language === 'en' ? 'en' : 'hi';
  }, [language]);

  const setLanguage = useCallback((lang: Language) => {
    setLanguageState(lang);
    try {
      window.localStorage.setItem(STORAGE_KEY, lang);
    } catch {
      /* ignore */
    }
  }, []);

  const t = useCallback(
    (key: string) => TRANSLATIONS[language]?.[key] ?? TRANSLATIONS[DEFAULT_LANGUAGE]?.[key] ?? key,
    [language]
  );

  const value = useMemo(() => ({ language, setLanguage, t }), [language, setLanguage, t]);

  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>;
}

export function useLanguage(): LanguageContextValue {
  const ctx = useContext(LanguageContext);
  if (!ctx) throw new Error('useLanguage() must be used inside a <LanguageProvider>');
  return ctx;
}
