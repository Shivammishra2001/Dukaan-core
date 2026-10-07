'use client';

import { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, MessageCircle, Plus } from 'lucide-react';
import { getCustomerLedger, listCustomers, recordCustomerPayment } from '@/lib/customer-client';
import { formatPaise } from '@/lib/money';
import { buildWhatsAppUrl } from '@/lib/hardware/whatsapp-share';
import { useLanguage } from '@/context/LanguageContext';
import { translateEnum, translateError } from '@/lib/translations';
import type { CustomerLedgerEntry, CustomerLite, PaymentMethod } from '@/types/customer';

const PAYMENT_METHODS: PaymentMethod[] = ['CASH', 'UPI', 'CARD', 'BANK_TRANSFER', 'CHEQUE'];

function RecordPaymentModal({
  open,
  onClose,
  onRecorded,
  customerId,
}: {
  open: boolean;
  onClose: () => void;
  onRecorded: (entry: CustomerLedgerEntry) => void;
  customerId: string;
}) {
  const { t } = useLanguage();
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState<PaymentMethod>('CASH');
  const [note, setNote] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!open) return null;

  async function handleSubmit() {
    const amountPaise = Math.round(Number(amount) * 100);
    if (!amountPaise || amountPaise <= 0) {
      setError(t('suppliers.enterValidAmount'));
      return;
    }
    setSubmitting(true);
    setError(null);
    const res = await recordCustomerPayment(customerId, {
      amount_paise: amountPaise,
      method,
      note: note.trim() || undefined,
    });
    setSubmitting(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    onRecorded(res.data);
    setAmount('');
    setNote('');
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/40 p-0 backdrop-blur-sm sm:items-center sm:p-4">
      <div className="w-full max-w-sm rounded-t-2xl bg-white p-5 shadow-2xl sm:rounded-2xl">
        <h2 className="text-base font-bold text-slate-900">{t('khata.recordPayment')}</h2>
        <p className="mt-0.5 text-xs text-slate-500">{t('khata.recordPaymentDesc')}</p>

        <label className="mt-4 block text-xs font-semibold text-slate-600">{t('khata.amountRs')}</label>
        <input
          type="number"
          inputMode="decimal"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          placeholder="0.00"
          className="mt-1 min-h-[48px] w-full rounded-lg border border-slate-200 px-3 text-lg font-bold outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
        />

        <label className="mt-3 block text-xs font-semibold text-slate-600">{t('khata.method')}</label>
        <div className="mt-1 grid grid-cols-3 gap-2">
          {PAYMENT_METHODS.map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setMethod(m)}
              className={`min-h-[44px] rounded-lg border px-2 text-xs font-semibold transition ${
                method === m ? 'border-primary bg-primary/10 text-primary' : 'border-slate-200 text-slate-600 hover:bg-slate-50'
              }`}
            >
              {translateEnum(t, 'enum.payment', m)}
            </button>
          ))}
        </div>

        <label className="mt-3 block text-xs font-semibold text-slate-600">{t('khata.noteOptional')}</label>
        <input
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder={t('khata.referencePlaceholder')}
          className="mt-1 min-h-[44px] w-full rounded-lg border border-slate-200 px-3 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
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
            className="min-h-[48px] flex-1 rounded-lg bg-primary text-sm font-bold text-white shadow-sm shadow-primary/25 transition hover:bg-primary-hover disabled:opacity-50"
          >
            {submitting ? t('khata.recordPayment') + '…' : t('khata.recordPayment')}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function CustomerLedgerPage({ params }: { params: { id: string } }) {
  const { t } = useLanguage();
  const [entries, setEntries] = useState<CustomerLedgerEntry[]>([]);
  const [balance, setBalance] = useState(0);
  const [customer, setCustomer] = useState<CustomerLite | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [paymentOpen, setPaymentOpen] = useState(false);
  const [lastReceipt, setLastReceipt] = useState<{ amountPaise: number; newBalancePaise: number } | null>(null);

  async function reload(cancelledRef?: { current: boolean }) {
    setLoading(true);
    const [ledgerRes, listRes] = await Promise.all([getCustomerLedger(params.id), listCustomers()]);
    if (cancelledRef?.current) return;
    setLoading(false);
    if (!ledgerRes.ok) {
      setError(ledgerRes.error);
      return;
    }
    setEntries(ledgerRes.data.entries);
    setBalance(ledgerRes.data.current_balance_paise);
    if (listRes.ok) setCustomer(listRes.data.find((c) => c.id === params.id) ?? null);
  }

  useEffect(() => {
    const cancelledRef = { current: false };
    void reload(cancelledRef);
    return () => {
      cancelledRef.current = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.id]);

  const whatsappUrl = useMemo(() => {
    const name = customer?.name ?? 'there';
    const amount = formatPaise(Math.max(balance, 0));
    const text =
      balance > 0
        ? `Namaste ${name} ji,\n\nAapka humare yahan ${amount} ka balance pending hai. Kripya jald bhugtan karein.\n\nDhanyavaad!`
        : `Namaste ${name} ji,\n\nAapka khata clear hai. Dhanyavaad!`;
    return buildWhatsAppUrl(text);
  }, [customer, balance]);

  /** Payment receipt link for the settlement just recorded — distinct from the standing balance-reminder link above (REQUIREMENTS.md §4.4 lists RECEIPT and REMINDER as separate WhatsApp payload kinds). */
  const receiptWhatsappUrl = useMemo(() => {
    if (!lastReceipt) return null;
    const name = customer?.name ?? 'there';
    const paid = formatPaise(lastReceipt.amountPaise);
    const newBalance = formatPaise(Math.max(lastReceipt.newBalancePaise, 0));
    const text =
      `Namaste ${name} ji,\n\nAapka payment of ${paid} humein mil gaya hai. Dhanyavaad!\n\n` +
      (lastReceipt.newBalancePaise > 0 ? `Bacha hua balance: ${newBalance}` : 'Aapka khata ab clear hai.');
    return buildWhatsAppUrl(text);
  }, [customer, lastReceipt]);

  return (
    <div className="w-full max-w-none px-4 py-4 sm:px-6 sm:py-6 lg:px-8">
      <a href="/customers/ledger" className="inline-flex min-h-[44px] items-center gap-1.5 text-sm font-semibold text-slate-500 hover:text-slate-700">
        <ArrowLeft size={16} /> {t('khata.backToKhata')}
      </a>

      <div className="mt-2 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-lg font-bold text-slate-900">{customer?.name ?? t('dispatch.customer')} — {t('khata.ledgerTitle')}</h1>
          {customer?.name_local && <p className="text-sm text-slate-500">{customer.name_local}</p>}
        </div>
        <div className="flex gap-2">
          <a
            href={whatsappUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="flex min-h-[44px] items-center gap-1.5 rounded-lg border border-emerald-200 bg-emerald-50 px-3 text-sm font-semibold text-emerald-700 hover:bg-emerald-100"
          >
            <MessageCircle size={16} /> {t('khata.whatsappReminder')}
          </a>
          <button
            type="button"
            onClick={() => setPaymentOpen(true)}
            className="flex min-h-[44px] items-center gap-1.5 rounded-lg bg-primary px-3 text-sm font-bold text-white shadow-sm hover:bg-primary-hover"
          >
            <Plus size={16} /> {t('khata.recordPayment')}
          </button>
        </div>
      </div>

      <div className="mt-4 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <span className="text-sm text-slate-500">{t('khata.outstandingBalance')}</span>
        <p className={`text-2xl font-black ${balance > 0 ? 'text-rose-600' : balance < 0 ? 'text-emerald-600' : 'text-slate-900'}`}>
          {formatPaise(Math.abs(balance))}
        </p>
        <p className="text-xs text-slate-400">{balance > 0 ? t('khata.customerOwes') : balance < 0 ? t('khata.advancePaidByCustomer') : t('khata.settled')}</p>
      </div>

      {lastReceipt && receiptWhatsappUrl && (
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-emerald-200 bg-emerald-50 p-3">
          <p className="text-sm text-emerald-800">
            {t('khata.paymentOf')} <strong>{formatPaise(lastReceipt.amountPaise)}</strong> {t('khata.recordedSendReceipt')}
          </p>
          <a
            href={receiptWhatsappUrl}
            target="_blank"
            rel="noopener noreferrer"
            onClick={() => setLastReceipt(null)}
            className="flex min-h-[40px] items-center gap-1.5 rounded-lg bg-emerald-600 px-3 text-sm font-semibold text-white hover:bg-emerald-700"
          >
            <MessageCircle size={15} /> {t('khata.sendWhatsappReceipt')}
          </a>
        </div>
      )}

      {error && <p className="mt-3 text-sm text-rose-600">{t('khata.couldNotLoadLedger')} ({translateError(t, error)}).</p>}
      {loading && <p className="mt-3 text-sm text-slate-500">{t('common.loading')}</p>}

      {!loading && !error && (
        <div className="mt-4 overflow-x-auto rounded-xl border border-slate-200 bg-white">
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
                  <td colSpan={6} className="px-3 py-8 text-center text-slate-500">
                    {t('khata.noLedgerEntries')}
                  </td>
                </tr>
              )}
              {entries.map((e) => (
                <tr key={e.id} className="border-t border-slate-100">
                  <td className="whitespace-nowrap px-3 py-2 text-slate-500">{e.entry_date}</td>
                  <td className="whitespace-nowrap px-3 py-2 text-slate-900">{translateEnum(t, 'enum.ledger', e.entry_type)}</td>
                  <td className="px-3 py-2 text-right text-slate-700">{e.direction === 'DEBIT' ? formatPaise(Number(e.amount_paise)) : ''}</td>
                  <td className="px-3 py-2 text-right text-emerald-700">{e.direction === 'CREDIT' ? formatPaise(Number(e.amount_paise)) : ''}</td>
                  <td className="px-3 py-2 text-right font-medium text-slate-900">{formatPaise(Number(e.running_balance_paise))}</td>
                  <td className="px-3 py-2 text-slate-500">{e.note ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <RecordPaymentModal
        open={paymentOpen}
        onClose={() => setPaymentOpen(false)}
        customerId={params.id}
        onRecorded={(entry) => {
          setPaymentOpen(false);
          setLastReceipt({ amountPaise: Number(entry.amount_paise), newBalancePaise: Number(entry.running_balance_paise) });
          void reload();
        }}
      />
    </div>
  );
}
