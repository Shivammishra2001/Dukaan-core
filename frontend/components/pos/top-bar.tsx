'use client';

import { forwardRef } from 'react';
import { Calculator, ChevronDown, DoorOpen, PackageOpen, Search, WalletCards, WifiOff } from 'lucide-react';
import { useLanguage } from '@/context/LanguageContext';
import type { StoreConfig } from '@/types/pos';

interface TopBarProps {
  storeConfig: StoreConfig;
  cashierName: string;
  parkedCount: number;
  searchValue: string;
  onSearchChange: (value: string) => void;
  onSearchSubmit: (value: string) => void;
  onShowShortcuts: () => void;
  onOpenParked: () => void;
  online: boolean;
  pendingSyncCount: number;
  onOpenCustomEntry: () => void;
  /** Omitted when shifts aren't enabled, or none is open yet. */
  onCloseShift?: () => void;
  onOpenCashMovement?: () => void;
}

/**
 * REQUIREMENTS.md scope: store switcher is a stub (multi-store isn't part of
 * Milestone 2 — this UI hook exists so it isn't a breaking change to wire up
 * later). The search/barcode box here is the *visible* manual-entry path;
 * the keyboard-wedge scanner (hooks/use-barcode-scanner.ts) listens
 * globally and works independent of this input's focus per
 * SYSTEM_ARCHITECTURE.md §6.1.
 */
export const TopBar = forwardRef<HTMLInputElement, TopBarProps>(function TopBar(
  {
    storeConfig,
    cashierName,
    parkedCount,
    searchValue,
    onSearchChange,
    onSearchSubmit,
    onShowShortcuts,
    onOpenParked,
    online,
    pendingSyncCount,
    onOpenCustomEntry,
    onCloseShift,
    onOpenCashMovement,
  },
  searchInputRef
) {
  const { t } = useLanguage();
  return (
    <header className="flex h-14 shrink-0 items-center gap-1.5 border-b border-slate-200/80 bg-white/90 px-2 text-slate-900 backdrop-blur-sm sm:gap-2.5 sm:px-3">
      {/*
       * Hidden below sm: the global MobileHeader (components/layout/MobileHeader.tsx)
       * already shows the store name there, so this would just duplicate it — and at
       * phone widths there isn't room for it alongside the search box and action
       * buttons anyway.
       */}
      <button
        type="button"
        title={t('pos.storeSwitcherStub')}
        className="hidden shrink-0 items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-800 hover:bg-slate-50 sm:flex"
        disabled
      >
        <span className="relative flex h-2 w-2">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
          <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
        </span>
        {storeConfig.store_name}
        <span className="font-normal text-slate-400">· {storeConfig.counter_name}</span>
        <ChevronDown size={13} />
      </button>

      <form
        className="relative min-w-0 flex-1"
        onSubmit={(e) => {
          e.preventDefault();
          if (searchValue.trim()) onSearchSubmit(searchValue.trim());
        }}
      >
        <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
        <input
          ref={searchInputRef}
          value={searchValue}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder={t('pos.searchPlaceholder')}
          className="w-full rounded-lg border border-slate-200 bg-slate-50 py-2 pl-9 pr-3 text-sm text-slate-900 placeholder:text-slate-400 transition focus:border-primary focus:bg-white focus:outline-none focus:ring-4 focus:ring-primary/10"
          autoComplete="off"
          spellCheck={false}
        />
      </form>

      {!online ? (
        <span className="flex shrink min-w-0 items-center gap-1 truncate rounded-full bg-rose-100 px-2.5 py-1 text-xs font-semibold text-rose-700">
          <WifiOff size={12} className="shrink-0" />
          <span className="truncate">
            {t('pos.offline')}{pendingSyncCount > 0 ? ` · ${pendingSyncCount} ${t('pos.order')}${pendingSyncCount === 1 ? '' : 's'} ${t('pos.pendingSync')}` : ''}
          </span>
        </span>
      ) : (
        pendingSyncCount > 0 && (
          <span className="shrink min-w-0 truncate rounded-full bg-amber-100 px-2.5 py-1 text-xs font-semibold text-amber-700">
            {t('pos.syncing')} {pendingSyncCount} {t('pos.order')}{pendingSyncCount === 1 ? '' : 's'}…
          </span>
        )
      )}

      {parkedCount > 0 && (
        <button
          type="button"
          onClick={onOpenParked}
          className="flex items-center gap-1 rounded-full bg-amber-100 px-2.5 py-1 text-xs font-semibold text-amber-700 hover:bg-amber-200"
        >
          <PackageOpen size={12} />
          {parkedCount} {t('pos.parked')}
        </button>
      )}

      <button
        type="button"
        onClick={onOpenCustomEntry}
        aria-label={t('pos.khulaHisaab')}
        className="flex shrink-0 items-center gap-1.5 rounded-lg border border-slate-200 px-2.5 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
        title={t('pos.khulaHisaab')}
      >
        <Calculator size={14} />
        <span className="hidden sm:inline">{t('pos.khulaHisaab')}</span>
      </button>

      {onOpenCashMovement && (
        <button
          type="button"
          onClick={onOpenCashMovement}
          aria-label={t('pos.cashInOut')}
          className="flex shrink-0 items-center gap-1.5 rounded-lg border border-slate-200 px-2.5 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
        >
          <WalletCards size={14} />
          <span className="hidden sm:inline">{t('pos.cashInOut')}</span>
        </button>
      )}

      {onCloseShift && (
        <button
          type="button"
          onClick={onCloseShift}
          aria-label={t('pos.closeShift')}
          className="flex shrink-0 items-center gap-1.5 rounded-lg border border-slate-200 px-2.5 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
        >
          <DoorOpen size={14} />
          <span className="hidden sm:inline">{t('pos.closeShift')}</span>
        </button>
      )}

      <button
        type="button"
        onClick={onShowShortcuts}
        className="shrink-0 rounded-lg border border-slate-200 px-2.5 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
        title={`${t('pos.keyboardShortcutsTitle')} (?)`}
      >
        ?
      </button>

      <div className="flex shrink-0 items-center gap-2 rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-sm sm:px-3">
        <span className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-primary to-accent text-xs font-bold text-white">
          {cashierName.slice(0, 1)}
        </span>
        <span className="hidden text-slate-800 sm:inline">{cashierName}</span>
      </div>
    </header>
  );
});
