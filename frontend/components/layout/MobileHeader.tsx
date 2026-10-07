'use client';

import { Menu } from 'lucide-react';
import { useSession } from '@/hooks/use-session';
import { useLanguage } from '@/context/LanguageContext';
import { LanguageSwitcher } from '@/components/ui/LanguageSwitcher';

interface MobileHeaderProps {
  onMenuClick: () => void;
}

/** Persistent top bar shown only below md (768px) — the desktop/tablet rail replaces it at md+. */
export function MobileHeader({ onMenuClick }: MobileHeaderProps) {
  const { profile, loading } = useSession();
  const { t } = useLanguage();

  return (
    <header className="sticky top-0 z-30 flex h-14 shrink-0 items-center gap-3 border-b border-slate-200 bg-white/95 px-3 backdrop-blur md:hidden">
      <button
        type="button"
        aria-label={t('nav.openMenu')}
        onClick={onMenuClick}
        className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg text-slate-600 hover:bg-slate-100 active:scale-95"
      >
        <Menu size={22} />
      </button>
      <div className="min-w-0">
        <p className="truncate text-sm font-bold text-slate-900">{loading ? t('common.loading') : profile?.store.name ?? t('common.appName')}</p>
      </div>
      <span className="relative ml-auto flex h-2 w-2 shrink-0">
        {profile?.active_shift && <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />}
        <span className={`relative inline-flex h-2 w-2 rounded-full ${profile?.active_shift ? 'bg-emerald-500' : 'bg-slate-300'}`} />
      </span>
      <LanguageSwitcher compact />
    </header>
  );
}
