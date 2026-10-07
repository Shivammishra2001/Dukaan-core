'use client';

import { useEffect, useState } from 'react';
import { Plus, X } from 'lucide-react';
import { getSupplierLedger, listSuppliers, paySupplier } from '@/lib/b2b-client';
import { formatPaise } from '@/lib/money';
import { useLanguage } from '@/context/LanguageContext';
import { translateEnum, translateError } from '@/lib/translations';
import type { RecordSupplierPaymentRequest, SupplierLedgerEntry, SupplierLite, SupplierPaymentMethod } from '@/types/b2b';

const SUPPLIER_PAYMENT_METHODS: SupplierPaymentMethod[] = ['CASH', 'UPI', 'BANK_TRANSFER', 'CHEQUE'];

function RecordSupplierPaymentModal({
  open,
  onClose,
  onRecorded,
  supplierId,
}: {
  open: boolean;
  onClose: () => void;
  onRecorded: () => void;
  supplierId: string;
}) {
  const { t } = useLanguage();
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState<SupplierPaymentMethod>('BANK_TRANSFER');
  const [reference, setReference] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const METHOD_LABELS: Record<SupplierPaymentMethod, string> = {
    CASH: t('suppliers.methodCash'),
    UPI: t('suppliers.methodUpi'),
    BANK_TRANSFER: t('suppliers.methodBankNeft'),
    CHEQUE: t('suppliers.methodCheque'),
  };

  if (!open) return null;

  async function handleSubmit() {
    const amountPaise = Math.round(Number(amount) * 100);
    if (!amountPaise || amountPaise <= 0) {
      setError(t('suppliers.enterValidAmount'));
      return;
    }
    setSubmitting(true);
    setError(null);
    const request: RecordSupplierPaymentRequest = { amount_paise: amountPaise, method, reference: reference.trim() || undefined };
    const res = await paySupplier(supplierId, request);
    setSubmitting(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    setAmount('');
    setReference('');
    onRecorded();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/40 p-0 backdrop-blur-sm sm:items-center sm:p-4">
      <div className="w-full max-w-sm rounded-t-2xl bg-white p-5 shadow-2xl sm:rounded-2xl">
        <div className="flex items-start justify-between">
          <div>
            <h2 className="text-base font-bold text-slate-900">{t('suppliers.settlePayment')}</h2>
            <p className="mt-0.5 text-xs text-slate-500">{t('suppliers.settlePaymentDesc')}</p>
          </div>
          <button onClick={onClose} className="flex h-9 w-9 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100">
            <X size={18} />
          </button>
        </div>

        <label className="mt-4 block text-xs font-semibold text-slate-600">{t('suppliers.amountRs')}</label>
        <input
          type="number"
          inputMode="decimal"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          placeholder="0.00"
          className="mt-1 min-h-[48px] w-full rounded-lg border border-slate-200 px-3 text-lg font-bold outline-none focus:border-primary focus:ring-2 focus:ring-primary/10"
        />

        <label className="mt-3 block text-xs font-semibold text-slate-600">{t('suppliers.method')}</label>
        <div className="mt-1 grid grid-cols-2 gap-2">
          {SUPPLIER_PAYMENT_METHODS.map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setMethod(m)}
              className={`min-h-[44px] rounded-lg border px-2 text-xs font-semibold transition ${
                method === m ? 'border-primary bg-primary/10 text-primary' : 'border-slate-200 text-slate-600 hover:bg-slate-50'
              }`}
            >
              {METHOD_LABELS[m]}
            </button>
          ))}
        </div>

        <label className="mt-3 block text-xs font-semibold text-slate-600">{t('suppliers.reference')}</label>
        <input
          value={reference}
          onChange={(e) => setReference(e.target.value)}
          placeholder={t('suppliers.reference')}
          className="mt-1 min-h-[44px] w-full rounded-lg border border-slate-200 px-3 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/10"
        />

        {error && <p className="mt-2 text-xs font-medium text-rose-600">{translateError(t, error)}</p>}

        <div className="mt-5 flex gap-2">
          <button
            type="button"
            onClick={onClose}
            className="min-h-[48px] flex-1 rounded-lg border border-slate-200 text-sm font-semibold text-slate-600 hover:bg-slate-50"
          >
            {t('common.cancel')}
          </button>
          <button
            type="button"
            disabled={submitting}
            onClick={handleSubmit}
            className="min-h-[48px] flex-1 rounded-lg bg-primary text-sm font-bold text-white shadow-sm hover:bg-primary-hover disabled:opacity-50"
          >
            {submitting ? t('suppliers.saving') : t('suppliers.settlePayment')}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function SupplierLedgerPage({ params }: { params: { id: string } }) {
  const { t } = useLanguage();
  const [entries, setEntries] = useState<SupplierLedgerEntry[]>([]);
  const [balance, setBalance] = useState(0);
  const [supplier, setSupplier] = useState<SupplierLite | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [paymentOpen, setPaymentOpen] = useState(false);

  async function reload() {
    setLoading(true);
    const [ledgerRes, listRes] = await Promise.all([getSupplierLedger(params.id), listSuppliers()]);
    setLoading(false);
    if (!ledgerRes.ok) return setError(ledgerRes.error);
    setEntries(ledgerRes.data.entries);
    setBalance(ledgerRes.data.current_balance_paise);
    if (listRes.ok) setSupplier(listRes.data.find((s) => s.id === params.id) ?? null);
  }

  useEffect(() => {
    void reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.id]);

  return (
    <div className="w-full max-w-none px-4 py-6 sm:px-6 lg:px-8">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold text-slate-900">{supplier?.name ?? t('b2b.supplier')} — {t('suppliers.ledgerTitle')}</h1>
          <p className="mt-1 text-sm text-slate-500">{t('suppliers.purchasesVsPayments')}</p>
        </div>
        <button
          type="button"
          onClick={() => setPaymentOpen(true)}
          className="flex min-h-[44px] items-center gap-1.5 rounded-lg bg-primary px-3 text-sm font-bold text-white shadow-sm hover:bg-primary-hover"
        >
          <Plus size={16} /> {t('suppliers.settlePayment')}
        </button>
      </div>

      <div className="mt-4 rounded-lg border border-slate-200 bg-white p-4">
        <span className="text-sm text-slate-500">{t('suppliers.outstandingPayable')}</span>
        <p className={`text-2xl font-bold ${balance > 0 ? 'text-rose-600' : 'text-emerald-600'}`}>{formatPaise(Math.abs(balance))}</p>
        <p className="text-xs text-slate-400">{balance > 0 ? t('suppliers.weOwe') : balance < 0 ? t('suppliers.advancePaid') : t('suppliers.settled')}</p>
      </div>

      {error && <p className="mt-3 text-sm text-rose-600">{t('suppliers.couldNotLoadLedger')} ({translateError(t, error)}).</p>}
      {loading && <p className="mt-3 text-sm text-slate-500">{t('common.loading')}</p>}

      {!loading && (
        <div className="mt-4 overflow-hidden rounded-lg border border-slate-200 bg-white">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
              <tr>
                <th className="px-3 py-2">{t('common.date')}</th>
                <th className="px-3 py-2">{t('common.type')}</th>
                <th className="px-3 py-2 text-right">{t('khata.debitCol')}</th>
                <th className="px-3 py-2 text-right">{t('khata.creditCol')}</th>
                <th className="px-3 py-2 text-right">{t('khata.balanceCol')}</th>
                <th className="px-3 py-2">{t('common.note')}</th>
              </tr>
            </thead>
            <tbody>
              {entries.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-3 py-6 text-center text-slate-500">
                    {t('suppliers.noLedgerEntries')}
                  </td>
                </tr>
              )}
              {entries.map((e) => (
                <tr key={e.id} className="border-t border-slate-100">
                  <td className="px-3 py-2 text-slate-500">{e.entry_date}</td>
                  <td className="px-3 py-2 text-slate-900">{translateEnum(t, 'enum.ledger', e.entry_type)}</td>
                  <td className="px-3 py-2 text-right text-slate-700">{e.direction === 'DEBIT' ? formatPaise(Number(e.amount_paise)) : ''}</td>
                  <td className="px-3 py-2 text-right text-slate-700">{e.direction === 'CREDIT' ? formatPaise(Number(e.amount_paise)) : ''}</td>
                  <td className="px-3 py-2 text-right font-medium text-slate-900">{formatPaise(Number(e.running_balance_paise))}</td>
                  <td className="px-3 py-2 text-slate-500">{e.note ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <RecordSupplierPaymentModal
        open={paymentOpen}
        onClose={() => setPaymentOpen(false)}
        supplierId={params.id}
        onRecorded={() => {
          setPaymentOpen(false);
          void reload();
        }}
      />
    </div>
  );
}
