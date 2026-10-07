'use client';

import { useState } from 'react';
import { DoorOpen, Loader2 } from 'lucide-react';
import { useShiftStore } from '@/stores/shift-store';
import { useLanguage } from '@/context/LanguageContext';
import { translateError } from '@/lib/translations';

interface OpenShiftDrawerProps {
  counterId: string;
  counterName: string;
  cashierName: string;
}

/**
 * REQUIREMENTS.md §5.1: a shift must be OPEN before the register can take
 * cash. This fully blocks the POS work area — rendered by app/pos/page.tsx
 * in place of the cart/catalogue whenever store.config.shift.enabled is
 * true and no shift is open yet.
 */
export function OpenShiftDrawer({ counterId, counterName, cashierName }: OpenShiftDrawerProps) {
  const { t } = useLanguage();
  const open = useShiftStore((s) => s.open);
  const busy = useShiftStore((s) => s.busy);
  const error = useShiftStore((s) => s.error);
  const clearError = useShiftStore((s) => s.clearError);

  const [floatRupees, setFloatRupees] = useState('2000');

  async function handleOpen() {
    clearError();
    const paise = Math.round(Number(floatRupees) * 100);
    if (!Number.isFinite(paise) || paise < 0) return;
    await open(counterId, paise);
  }

  return (
    <div className="flex h-full flex-1 items-center justify-center bg-gradient-to-b from-slate-50 to-slate-100 p-4">
      <div className="w-full max-w-sm rounded-2xl border border-slate-200/80 bg-white p-6 shadow-xl shadow-slate-200/50">
        <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-br from-emerald-500 to-emerald-600 text-white shadow-sm">
          <DoorOpen size={22} />
        </span>
        <h1 className="mt-4 text-lg font-black text-slate-900">{t('pos.openShift')}</h1>
        <p className="mt-1 text-sm text-slate-500">
          {counterName} · {cashierName}
        </p>

        <label className="mt-5 block text-sm font-semibold text-slate-700">
          {t('pos.openingCashFloat')}
          <input
            autoFocus
            value={floatRupees}
            onChange={(e) => setFloatRupees(e.target.value)}
            inputMode="decimal"
            className="mt-1.5 w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-lg font-bold text-slate-900 transition focus:border-emerald-500 focus:bg-white focus:outline-none focus:ring-4 focus:ring-emerald-500/10"
          />
        </label>

        {error && <p className="mt-3 rounded-xl bg-rose-50 px-3 py-2 text-sm text-rose-700">{translateError(t, error)}</p>}

        <button
          type="button"
          onClick={handleOpen}
          disabled={busy}
          className="mt-5 flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-emerald-500 to-emerald-600 py-3.5 text-sm font-bold text-white shadow-lg shadow-emerald-500/25 transition hover:shadow-emerald-500/40 active:scale-[0.98] disabled:cursor-not-allowed disabled:from-slate-300 disabled:to-slate-300 disabled:shadow-none"
        >
          {busy && <Loader2 size={16} className="animate-spin" />}
          {busy ? t('pos.opening') : t('pos.openShiftStart')}
        </button>
      </div>
    </div>
  );
}
