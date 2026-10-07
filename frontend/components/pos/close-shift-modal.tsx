'use client';

import { useEffect, useState } from 'react';
import { Banknote, Loader2, X } from 'lucide-react';
import { useShiftStore } from '@/stores/shift-store';
import { replayOutbox } from '@/lib/sync/outbox-sync';
import { formatPaise, formatSignedPaise } from '@/lib/money';
import { useLanguage } from '@/context/LanguageContext';
import { translateError } from '@/lib/translations';
import type { CloseShiftResponse, DenominationCount, ExpectedCashResponse } from '@/types/shift';

const DENOMS: { key: keyof DenominationCount; rupees: number }[] = [
  { key: 'd2000', rupees: 2000 },
  { key: 'd500', rupees: 500 },
  { key: 'd200', rupees: 200 },
  { key: 'd100', rupees: 100 },
  { key: 'd50', rupees: 50 },
  { key: 'd20', rupees: 20 },
  { key: 'd10', rupees: 10 },
  { key: 'd5', rupees: 5 },
  { key: 'd2', rupees: 2 },
  { key: 'd1', rupees: 1 },
];

/** REQUIREMENTS.md §5.3: mirrors backend/src/api/shift/services/shift-lifecycle.ts#actualCashFromDenomination exactly, for a live preview before submit. */
function actualCashFromDenomination(count: DenominationCount): number {
  let total = 0;
  for (const { key, rupees } of DENOMS) total += (count[key] ?? 0) * rupees * 100;
  return total + (count.coins_paise ?? 0);
}

export function CloseShiftModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useLanguage();
  const shift = useShiftStore((s) => s.shift);
  const busy = useShiftStore((s) => s.busy);
  const error = useShiftStore((s) => s.error);
  const refreshExpected = useShiftStore((s) => s.refreshExpected);
  const checkOutboxGate = useShiftStore((s) => s.checkOutboxGate);
  const closeShift = useShiftStore((s) => s.close);
  const clearError = useShiftStore((s) => s.clearError);

  const [expected, setExpected] = useState<ExpectedCashResponse | null>(null);
  const [counts, setCounts] = useState<DenominationCount>({});
  const [reasonCode, setReasonCode] = useState<CloseShiftResponseReasonCode>('MISCOUNT');
  const [reasonText, setReasonText] = useState('');
  const [approvalPin, setApprovalPin] = useState('');
  const [result, setResult] = useState<CloseShiftResponse | null>(null);

  const [pendingOutboxCount, setPendingOutboxCount] = useState(0);
  const [syncing, setSyncing] = useState(false);
  const [forceCloseAnyway, setForceCloseAnyway] = useState(false);

  useEffect(() => {
    if (!open) return;
    setResult(null);
    setCounts({});
    setReasonText('');
    setApprovalPin('');
    setForceCloseAnyway(false);
    clearError();
    void refreshExpected().then(setExpected);
    void checkOutboxGate().then(setPendingOutboxCount);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  if (!open || !shift) return null;

  const actual = actualCashFromDenomination(counts);
  const expectedPaise = expected?.expected_cash_paise ?? 0;
  const variance = actual - expectedPaise;
  const tolerance = 1000; // ₹10 default (REQUIREMENTS.md §5.4) — the server is authoritative
  const needsVarianceReason = Math.abs(variance) > tolerance;
  const hasPendingSync = pendingOutboxCount > 0;
  // Rule SH-4: a nonempty outbox blocks close outright, unless a supervisor
  // explicitly overrides it (connectivity permanently lost — e.g. hardware failure).
  const blockedByOutbox = hasPendingSync && !forceCloseAnyway;
  const needsApproval = needsVarianceReason || (hasPendingSync && forceCloseAnyway);

  async function handleForceSyncNow() {
    setSyncing(true);
    await replayOutbox();
    setPendingOutboxCount(await checkOutboxGate());
    setSyncing(false);
  }

  async function handleClose() {
    const res = await closeShift({
      denomination_count: counts,
      variance_reason_code: needsVarianceReason ? reasonCode : undefined,
      variance_reason_text: needsVarianceReason ? reasonText || undefined : undefined,
      approval_token: needsApproval && approvalPin ? approvalPin : undefined,
      has_pending_offline_sync: hasPendingSync,
    });
    if (res) setResult(res);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4">
      <div className="flex max-h-[90vh] w-full max-w-lg flex-col overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-2xl">
        <header className="flex items-center justify-between border-b border-slate-200 px-4 py-3.5">
          <h2 className="flex items-center gap-2 text-sm font-bold text-slate-900">
            <Banknote size={16} className="text-slate-500" />
            {result ? t('pos.shiftClosedZReport') : t('pos.closeShiftTitle')}
          </h2>
          <button type="button" onClick={onClose} className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700" aria-label={t('common.close')}>
            <X size={16} />
          </button>
        </header>

        {result ? (
          <div className="flex-1 space-y-3 overflow-y-auto p-4 text-sm">
            <Row label={t('pos.bills')} value={String(result.z_report.bill_count)} />
            <Row label={t('pos.avgBill')} value={formatPaise(result.z_report.avg_bill_paise)} />
            <Row label={t('pos.discountsGiven')} value={formatPaise(result.z_report.discount_total_paise)} />
            <div className="border-t border-slate-200 pt-2">
              <Row label={t('pos.expectedCash')} value={formatPaise(result.expected_cash_paise)} />
              <Row label={t('pos.actualCash')} value={formatPaise(result.actual_cash_paise)} />
              <Row
                label={t('pos.variance')}
                value={formatSignedPaise(result.variance_paise)}
                emphasis
                tone={result.variance_paise === 0 ? 'neutral' : result.variance_paise < 0 ? 'shortage' : 'overage'}
              />
            </div>
            <p className="rounded-md bg-slate-100 px-3 py-2 text-xs text-slate-600">
              {t('pos.classification')}: <span className="font-semibold">{result.variance_classification}</span>
            </p>
            <button
              type="button"
              onClick={onClose}
              className="mt-2 w-full rounded-xl bg-gradient-to-r from-emerald-500 to-emerald-600 py-3 text-sm font-bold text-white shadow-md shadow-emerald-500/25 transition active:scale-[0.98]"
            >
              {t('pos.done')}
            </button>
          </div>
        ) : (
          <div className="flex-1 overflow-y-auto p-4">
            <div className="mb-3 rounded-lg bg-slate-50 p-3 text-sm">
              <Row label={t('pos.openingFloatLabel')} value={formatPaise(shift.opening_float_paise)} />
              <Row label={t('pos.cashSalesLabel')} value={formatPaise(expected?.cash_sales_paise ?? 0)} />
              <Row label={t('pos.expectedCash')} value={formatPaise(expectedPaise)} emphasis />
            </div>

            {hasPendingSync && (
              <div className="mb-3 space-y-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-xs">
                <p className="font-semibold text-amber-800">
                  {t('pos.cannotCloseShift')} {pendingOutboxCount} {t('pos.pendingOfflineOrders')}{pendingOutboxCount === 1 ? '' : 's'}. {t('pos.syncOutboxFirst')}
                </p>
                <button
                  type="button"
                  onClick={handleForceSyncNow}
                  disabled={syncing}
                  className="rounded bg-amber-600 px-3 py-1.5 font-semibold text-white hover:bg-amber-500 disabled:cursor-not-allowed disabled:bg-amber-300"
                >
                  {syncing ? t('pos.syncing') + '…' : t('pos.forceSyncNow')}
                </button>

                <label className="flex items-center gap-2 pt-1 text-amber-800">
                  <input type="checkbox" checked={forceCloseAnyway} onChange={(e) => setForceCloseAnyway(e.target.checked)} />
                  {t('pos.connectivityLost')}
                </label>
              </div>
            )}

            <p className="mb-2 text-xs font-bold uppercase tracking-wide text-slate-500">{t('pos.denominationCount')}</p>
            <div className="grid grid-cols-5 gap-2">
              {DENOMS.map((d) => (
                <label key={d.key} className="rounded-xl border border-slate-200 bg-slate-50 p-1.5 text-center text-xs font-semibold text-slate-500">
                  ₹{d.rupees}
                  <input
                    value={counts[d.key] ?? ''}
                    onChange={(e) => setCounts((c) => ({ ...c, [d.key]: Math.max(0, Math.trunc(Number(e.target.value) || 0)) }))}
                    inputMode="numeric"
                    className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-1 py-1.5 text-center text-sm font-bold text-slate-900"
                  />
                </label>
              ))}
            </div>
            <label className="mt-2 block text-xs font-semibold text-slate-500">
              {t('pos.coinsRs')}
              <input
                value={counts.coins_paise != null ? counts.coins_paise / 100 : ''}
                onChange={(e) => setCounts((c) => ({ ...c, coins_paise: Math.max(0, Math.round(Number(e.target.value) * 100) || 0) }))}
                inputMode="decimal"
                className="mt-1.5 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-900"
              />
            </label>

            <div className="mt-3 rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm">
              <Row label={t('pos.actualCashCounted')} value={formatPaise(actual)} />
              <Row
                label={t('pos.variance')}
                value={formatSignedPaise(variance)}
                emphasis
                tone={variance === 0 ? 'neutral' : variance < 0 ? 'shortage' : 'overage'}
              />
            </div>

            {needsVarianceReason && (
              <div className="mt-3 space-y-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-xs">
                <p className="font-semibold text-amber-800">{t('pos.varianceExceedsTolerance')}</p>
                <select
                  value={reasonCode}
                  onChange={(e) => setReasonCode(e.target.value as CloseShiftResponseReasonCode)}
                  className="w-full rounded border border-amber-300 bg-white px-2 py-1.5"
                >
                  <option value="MISCOUNT">{t('pos.reasonMiscount')}</option>
                  <option value="CHANGE_ERROR">{t('pos.reasonChangeError')}</option>
                  <option value="UNRECORDED_PAYOUT">{t('pos.reasonUnrecordedPayout')}</option>
                  <option value="THEFT_SUSPECTED">{t('pos.reasonTheftSuspected')}</option>
                  <option value="OTHER">{t('pos.reasonOther')}</option>
                </select>
                <textarea
                  value={reasonText}
                  onChange={(e) => setReasonText(e.target.value)}
                  placeholder={t('pos.detailsPlaceholder')}
                  className="w-full rounded border border-amber-300 bg-white px-2 py-1.5"
                  rows={2}
                />
              </div>
            )}

            {needsApproval && (
              <input
                value={approvalPin}
                onChange={(e) => setApprovalPin(e.target.value)}
                placeholder={t('pos.supervisorPin')}
                type="password"
                className="mt-3 w-full rounded border border-amber-300 bg-amber-50 px-2 py-1.5 text-sm"
              />
            )}

            {error && <p className="mt-3 text-sm text-rose-600">{translateError(t, error)}</p>}

            <button
              type="button"
              onClick={handleClose}
              disabled={busy || blockedByOutbox || (needsApproval && !approvalPin)}
              title={blockedByOutbox ? t('pos.syncOutboxHint') : undefined}
              className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-emerald-500 to-emerald-600 py-3.5 text-sm font-bold text-white shadow-lg shadow-emerald-500/25 transition hover:shadow-emerald-500/40 active:scale-[0.98] disabled:cursor-not-allowed disabled:from-slate-300 disabled:to-slate-300 disabled:shadow-none"
            >
              {busy && <Loader2 size={16} className="animate-spin" />}
              {busy ? t('pos.closing') : t('pos.closeShiftTitle')}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

type CloseShiftResponseReasonCode = NonNullable<import('@/types/shift').CloseShiftRequest['variance_reason_code']>;

function Row({
  label,
  value,
  emphasis,
  tone,
}: {
  label: string;
  value: string;
  emphasis?: boolean;
  tone?: 'overage' | 'shortage' | 'neutral';
}) {
  // REQUIREMENTS.md §5.4-style presentation, per design brief: shortage in red, overage in blue.
  const toneClass = tone === 'overage' ? 'text-blue-600' : tone === 'shortage' ? 'text-rose-600' : 'text-slate-900';
  return (
    <div className={`flex items-center justify-between ${emphasis ? 'font-semibold' : ''}`}>
      <span className="text-slate-500">{label}</span>
      <span className={emphasis ? toneClass : 'text-slate-800'}>{value}</span>
    </div>
  );
}
