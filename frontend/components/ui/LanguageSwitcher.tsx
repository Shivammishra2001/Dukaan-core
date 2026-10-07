'use client';

import { useLanguage } from '@/context/LanguageContext';
import { LANGUAGES } from '@/lib/translations';

const SHORT_LABEL: Record<string, string> = { en: 'EN', hi: 'हिं', 'hi-Latn': 'Hg' };

/** Inline switcher pill — `[🇮🇳 हिंदी | English | Hinglish]`, one tap to swap the active language everywhere (nav labels, B2B forms, POS labels). Used in both <AppSidebar /> and <MobileHeader />. */
export function LanguageSwitcher({ compact = false }: { compact?: boolean }) {
  const { language, setLanguage, t } = useLanguage();

  return (
    <div className={`flex items-center overflow-hidden rounded-full border border-slate-200 bg-white ${compact ? 'text-[10px]' : 'text-xs'}`} role="group" aria-label={t('common.language')}>
      {LANGUAGES.map((l, i) => (
        <button
          key={l.code}
          type="button"
          onClick={() => setLanguage(l.code)}
          className={`min-h-[28px] px-2 font-bold transition ${i > 0 ? 'border-l border-slate-200' : ''} ${
            language === l.code ? 'bg-primary text-white' : 'text-slate-600 hover:bg-slate-50'
          }`}
          aria-pressed={language === l.code}
        >
          {l.code === 'en' ? '' : '🇮🇳 '}
          {compact ? SHORT_LABEL[l.code] : l.label}
        </button>
      ))}
    </div>
  );
}
