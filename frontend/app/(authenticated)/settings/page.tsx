'use client';

import { Palette, Settings as SettingsIcon } from 'lucide-react';
import { useLanguage } from '@/context/LanguageContext';
import { LANGUAGES } from '@/lib/translations';
import { ThemePicker } from '@/components/ui/ThemePicker';

export default function SettingsPage() {
  const { language, setLanguage, t } = useLanguage();

  return (
    <div className="w-full max-w-2xl px-4 py-6 sm:px-6 lg:px-8">
      <div className="flex items-center gap-3">
        <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-gradient-to-br from-primary to-accent text-white shadow-sm">
          <SettingsIcon size={20} />
        </span>
        <div>
          <h1 className="text-lg font-bold text-slate-900">{t('common.settings')}</h1>
          <p className="text-sm text-slate-500">{t('settings.subtitle')}</p>
        </div>
      </div>

      <div className="mt-6 rounded-2xl border border-slate-200/80 bg-white p-4 shadow-sm">
        <p className="text-sm font-bold text-slate-900">{t('common.language')}</p>
        <p className="text-xs text-slate-500">{t('settings.languageHint')}</p>
        <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-3">
          {LANGUAGES.map((l) => (
            <button
              key={l.code}
              type="button"
              onClick={() => setLanguage(l.code)}
              className={`flex items-center gap-2 rounded-xl border px-3 py-2.5 text-left text-sm transition ${
                language === l.code ? 'border-primary bg-primary/5 ring-2 ring-primary/20 font-semibold text-slate-900' : 'border-slate-200 text-slate-600 hover:bg-slate-50'
              }`}
            >
              <span>{l.code === 'en' ? '🌐' : '🇮🇳'}</span>
              {l.label}
            </button>
          ))}
        </div>
      </div>

      <div className="mt-4 rounded-2xl border border-slate-200/80 bg-white p-4 shadow-sm">
        <div className="flex items-center gap-2">
          <Palette size={16} className="text-slate-400" />
          <p className="text-sm font-bold text-slate-900">{t('common.theme')}</p>
        </div>
        <p className="text-xs text-slate-500">{t('settings.themeHint')}</p>
        <div className="mt-3">
          <ThemePicker variant="inline" />
        </div>
      </div>
    </div>
  );
}
