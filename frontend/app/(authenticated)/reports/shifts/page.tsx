'use client';

import { useEffect, useState } from 'react';
import { History } from 'lucide-react';
import { getShiftHistory } from '@/lib/shift-client';
import { formatPaise, formatSignedPaise } from '@/lib/money';
import { useLanguage } from '@/context/LanguageContext';
import { dateLocale, translateEnum, translateError, type Language } from '@/lib/translations';
import type { ShiftHistoryRow } from '@/types/shift';

const STATUS_STYLES: Record<ShiftHistoryRow['status'], string> = {
  OPEN: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  PENDING_COUNT: 'bg-amber-50 text-amber-700 border-amber-200',
  CLOSED: 'bg-slate-100 text-slate-600 border-slate-200',
  UNDER_REVIEW: 'bg-rose-50 text-rose-700 border-rose-200',
};

function formatDateTime(iso: string | null, language: Language): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString(dateLocale(language), { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
}

/** Galla & Shift History — every past cashier shift: opening float, cash sales, petty cash movements, counted drawer cash and variance. */
export default function ShiftHistoryPage() {
  const { t, language } = useLanguage();
  const [shifts, setShifts] = useState<ShiftHistoryRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void getShiftHistory().then((res) => {
      if (cancelled) return;
      setLoading(false);
      if (!res.ok) return setError(res.error);
      setShifts(res.data);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="mx-auto max-w-5xl p-4 sm:p-6">
      <h1 className="text-lg font-bold text-slate-900">{t('reports.title')}</h1>
      <p className="mt-1 text-sm text-slate-500">{t('reports.subtitle')}</p>

      {error && <p className="mt-4 text-sm text-rose-600">{t('reports.couldNotLoad')} ({translateError(t, error)}).</p>}
      {loading && <p className="mt-4 text-sm text-slate-500">{t('common.loading')}</p>}

      {!loading && !error && (
        <div className="mt-4 overflow-x-auto rounded-xl border border-slate-200 bg-white">
          {shifts.length === 0 ? (
            <div className="flex flex-col items-center gap-2 px-4 py-10 text-center text-slate-400">
              <History size={28} />
              <p className="text-sm">{t('reports.noShiftsRecorded')}</p>
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
                <tr>
                  <th className="px-3 py-2">{t('reports.cashier')}</th>
                  <th className="px-3 py-2">{t('reports.opened')}</th>
                  <th className="px-3 py-2">{t('reports.closed')}</th>
                  <th className="px-3 py-2 text-right">{t('reports.openingFloat')}</th>
                  <th className="px-3 py-2 text-right">{t('reports.cashSales')}</th>
                  <th className="px-3 py-2 text-right">{t('reports.pettyInOut')}</th>
                  <th className="px-3 py-2 text-right">{t('reports.countedCash')}</th>
                  <th className="px-3 py-2 text-right">{t('reports.variance')}</th>
                  <th className="px-3 py-2">{t('common.status')}</th>
                </tr>
              </thead>
              <tbody>
                {shifts.map((s) => (
                  <tr key={s.id} className="border-t border-slate-100">
                    <td className="px-3 py-2.5">
                      <p className="font-semibold text-slate-900">{s.cashier?.full_name ?? '—'}</p>
                      <p className="text-xs text-slate-500">{s.counter?.name ?? s.counter?.code ?? '—'}</p>
                    </td>
                    <td className="whitespace-nowrap px-3 py-2.5 text-slate-600">{formatDateTime(s.opened_at, language)}</td>
                    <td className="whitespace-nowrap px-3 py-2.5 text-slate-600">{formatDateTime(s.closed_at, language)}</td>
                    <td className="px-3 py-2.5 text-right text-slate-600">{formatPaise(s.opening_float_paise)}</td>
                    <td className="px-3 py-2.5 text-right font-semibold text-slate-900">{formatPaise(s.cash_sales_paise)}</td>
                    <td className="px-3 py-2.5 text-right text-slate-600">
                      +{formatPaise(s.cash_in_paise)} / -{formatPaise(s.cash_out_paise)}
                    </td>
                    <td className="px-3 py-2.5 text-right text-slate-600">{s.actual_cash_paise != null ? formatPaise(s.actual_cash_paise) : '—'}</td>
                    <td className={`px-3 py-2.5 text-right font-semibold ${s.variance_paise == null ? 'text-slate-400' : s.variance_paise < 0 ? 'text-rose-600' : s.variance_paise > 0 ? 'text-amber-600' : 'text-emerald-600'}`}>
                      {s.variance_paise != null ? formatSignedPaise(s.variance_paise) : '—'}
                    </td>
                    <td className="px-3 py-2.5">
                      <span className={`rounded-full border px-2 py-0.5 text-[11px] font-semibold ${STATUS_STYLES[s.status]}`}>{translateEnum(t, 'enum.shiftStatus', s.status)}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  );
}
