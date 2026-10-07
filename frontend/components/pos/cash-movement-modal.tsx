'use client';

import { useEffect, useState } from 'react';
import { ArrowDownCircle, ArrowUpCircle, CheckCircle2, Loader2, X } from 'lucide-react';
import { useShiftStore } from '@/stores/shift-store';
import { useLanguage } from '@/context/LanguageContext';
import { translateError } from '@/lib/translations';
import type { CashMovementReasonCode } from '@/types/shift';

/** REQUIREMENTS.md §5.2 cash_in_paise/cash_out_paise. Accessible from the POS top bar, independent of the shift-close flow. */
export function CashMovementModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useLanguage();
  const REASONS: { value: CashMovementReasonCode; label: string }[] = [
    { value: 'OWNER_DRAW', label: t('pos.reasonOwnerDraw') },
    { value: 'PETTY_EXPENSE', label: t('pos.reasonPettyExpense') },
    { value: 'FLOAT_ADD', label: t('pos.reasonFloatAdd') },
    { value: 'OTHER', label: t('pos.reasonOther') },
  ];
  const busy = useShiftStore((s) => s.busy);
  const error = useShiftStore((s) => s.error);
  const clearError = useShiftStore((s) => s.clearError);
  const cashMovement = useShiftStore((s) => s.cashMovement);

  const [direction, setDirection] = useState<'IN' | 'OUT'>('OUT');
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState<CashMovementReasonCode>('PETTY_EXPENSE');
  const [note, setNote] = useState('');
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (!open) return;
    setAmount('');
    setNote('');
    setDone(false);
    clearError();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  if (!open) return null;

  async function handleSubmit() {
    const paise = Math.round(Number(amount) * 100);
    if (!Number.isFinite(paise) || paise <= 0) return;
    const ok = await cashMovement(direction, paise, reason, note || undefined);
    if (ok) setDone(true);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4 backdrop-blur-sm">
      <div className="w-full max-w-sm rounded-2xl border border-slate-200/80 bg-white p-4 shadow-2xl">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-bold text-slate-900">{t('pos.cashInCashOut')}</h2>
          <button type="button" onClick={onClose} className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700" aria-label={t('common.close')}>
            <X size={16} />
          </button>
        </div>

        {done ? (
          <div className="space-y-3 text-center">
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-gradient-to-br from-emerald-500 to-emerald-600 text-white shadow-md shadow-emerald-500/30">
              <CheckCircle2 size={22} />
            </div>
            <p className="text-sm font-semibold text-emerald-600">{t('pos.recorded')}</p>
            <button
              type="button"
              onClick={onClose}
              className="w-full rounded-xl bg-gradient-to-r from-emerald-500 to-emerald-600 py-3 text-sm font-bold text-white shadow-md shadow-emerald-500/25 transition active:scale-[0.98]"
            >
              {t('pos.done')}
            </button>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setDirection('IN')}
                className={`flex min-h-[48px] items-center justify-center gap-1.5 rounded-xl border text-sm font-bold transition active:scale-[0.98] ${
                  direction === 'IN' ? 'border-primary bg-primary/10 text-primary ring-1 ring-primary' : 'border-slate-200 text-slate-600 hover:bg-slate-50'
                }`}
              >
                <ArrowDownCircle size={15} />
                {t('pos.cashIn')}
              </button>
              <button
                type="button"
                onClick={() => setDirection('OUT')}
                className={`flex min-h-[48px] items-center justify-center gap-1.5 rounded-xl border text-sm font-bold transition active:scale-[0.98] ${
                  direction === 'OUT' ? 'border-rose-500 bg-rose-50 text-rose-700 ring-1 ring-rose-500' : 'border-slate-200 text-slate-600 hover:bg-slate-50'
                }`}
              >
                <ArrowUpCircle size={15} />
                {t('pos.cashOut')}
              </button>
            </div>

            <label className="block text-xs font-semibold text-slate-500">
              {t('pos.amountRs')}
              <input
                autoFocus
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                inputMode="decimal"
                className="mt-1.5 w-full rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-lg font-bold text-slate-900 transition focus:border-emerald-500 focus:bg-white focus:outline-none focus:ring-4 focus:ring-emerald-500/10"
              />
            </label>

            <label className="block text-xs font-semibold text-slate-500">
              {t('pos.reason')}
              <select
                value={reason}
                onChange={(e) => setReason(e.target.value as CashMovementReasonCode)}
                className="mt-1.5 w-full rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-sm font-medium text-slate-900"
              >
                {REASONS.map((r) => (
                  <option key={r.value} value={r.value}>
                    {r.label}
                  </option>
                ))}
              </select>
            </label>

            <label className="block text-xs font-semibold text-slate-500">
              {t('pos.notesOptional')}
              <input
                value={note}
                onChange={(e) => setNote(e.target.value)}
                className="mt-1.5 w-full rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-sm font-medium text-slate-900"
              />
            </label>

            {error && <p className="rounded-xl bg-rose-50 px-3 py-2 text-sm text-rose-700">{translateError(t, error)}</p>}

            <button
              type="button"
              onClick={handleSubmit}
              disabled={busy || !amount}
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-emerald-500 to-emerald-600 py-3 text-sm font-bold text-white shadow-md shadow-emerald-500/25 transition active:scale-[0.98] disabled:cursor-not-allowed disabled:from-slate-300 disabled:to-slate-300 disabled:shadow-none"
            >
              {busy && <Loader2 size={15} className="animate-spin" />}
              {busy ? t('pos.saving') : direction === 'IN' ? t('pos.recordCashIn') : t('pos.recordCashOut')}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
