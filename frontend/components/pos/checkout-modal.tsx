'use client';

import { useEffect, useState } from 'react';
import { Banknote, CheckCircle2, CreditCard, Loader2, MessageCircle, Printer, QrCode, Wallet, X } from 'lucide-react';
import { usePosStore } from '@/stores/pos-store';
import type { InvoiceTotals } from '@/lib/pricing';
import { paymentsCoverTotal } from '@/lib/pricing';
import { wouldBreachCreditLimit } from '@/lib/credit';
import { formatPaise } from '@/lib/money';
import { buildLocalOrderResponse } from '@/lib/build-local-order-response';
import { dispatchPrint } from '@/lib/hardware/printer-transport';
import { generateInvoicePdf, invoicePdfFilename, type PdfTemplate } from '@/lib/hardware/invoice-pdf';
import { shareReceipt } from '@/lib/hardware/whatsapp-share';
import { useLanguage } from '@/context/LanguageContext';
import { translateError } from '@/lib/translations';
import type { CreateOrderResponse } from '@/types/checkout';
import type { PaymentMethod, StoreConfig } from '@/types/pos';

interface CheckoutModalProps {
  open: boolean;
  onClose: () => void;
  totals: InvoiceTotals;
  storeConfig: StoreConfig;
  cashierName: string;
  onCompleted: (invoiceNo: string) => void;
}

type PrintStatus = 'idle' | 'printing' | 'done' | 'failed';

/**
 * REQUIREMENTS.md §7.1 (ERR_PAYMENT_MISMATCH, ERR_CUSTOMER_REQUIRED,
 * ERR_CREDIT_LIMIT_BREACH) + §4.2 (credit enforcement modes) +
 * SYSTEM_ARCHITECTURE.md §6.3 ("print is never on the transaction path" —
 * the print job here runs strictly after the mocked checkout.service call
 * resolves, and its own failure/retry state never touches the completed
 * sale).
 */
export function CheckoutModal({ open, onClose, totals, storeConfig, cashierName, onCompleted }: CheckoutModalProps) {
  const { t } = useLanguage();
  const METHODS: { method: PaymentMethod; label: string; icon: typeof Banknote }[] = [
    { method: 'CASH', label: t('pos.methodCash'), icon: Banknote },
    { method: 'UPI', label: t('pos.methodUpi'), icon: QrCode },
    { method: 'CARD', label: t('pos.methodCard'), icon: CreditCard },
    { method: 'CREDIT', label: t('pos.methodCredit'), icon: Wallet },
  ];
  const creditEnforcementMode = storeConfig.credit_enforcement_mode;
  const customer = usePosStore((s) => s.customer);
  const payments = usePosStore((s) => s.payments);
  const addPayment = usePosStore((s) => s.addPayment);
  const removePayment = usePosStore((s) => s.removePayment);
  const submit = usePosStore((s) => s.submit);
  const resetCart = usePosStore((s) => s.reset);

  const [selectedMethod, setSelectedMethod] = useState<PaymentMethod>('CASH');
  const [amountInput, setAmountInput] = useState('');
  const [tenderedInput, setTenderedInput] = useState('');
  const [approvalPin, setApprovalPin] = useState('');
  const [warnAcknowledged, setWarnAcknowledged] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<{ invoiceNo: string; offline: boolean; order: CreateOrderResponse } | null>(null);
  const [printStatus, setPrintStatus] = useState<PrintStatus>('idle');
  const [shareStatus, setShareStatus] = useState<string | null>(null);

  const paid = payments.reduce((sum, p) => sum + p.amount_paise, 0);
  const remaining = Math.max(0, totals.total_paise - paid);
  const fullyPaid = paymentsCoverTotal(payments, totals.total_paise);

  useEffect(() => {
    if (!open) return;
    setAmountInput(remaining > 0 ? (remaining / 100).toFixed(2) : '');
    setTenderedInput(remaining > 0 ? (remaining / 100).toFixed(2) : '');
    setApprovalPin('');
    setWarnAcknowledged(false);
    setFormError(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedMethod, open]);

  useEffect(() => {
    if (!open) {
      setResult(null);
      setPrintStatus('idle');
      setSubmitting(false);
    }
  }, [open]);

  useEffect(() => {
    if (!result) return;
    // SYSTEM_ARCHITECTURE.md §6.3: print is never on the transaction path —
    // this only ever runs after `result` is set, which only happens once
    // the sale is durably persisted (Rule FE-5), online or offline.
    setPrintStatus('printing');
    let cancelled = false;
    void dispatchPrint(result.order.print_payload, '58mm').then((printResult) => {
      if (!cancelled) setPrintStatus(printResult.ok ? 'done' : 'failed');
    });
    return () => {
      cancelled = true;
    };
  }, [result]);

  if (!open) return null;

  const creditBreach = selectedMethod === 'CREDIT' && customer ? wouldBreachCreditLimit(customer, remaining) : false;

  function handleAddPayment() {
    setFormError(null);
    const amountPaise = Math.round(Number(amountInput) * 100);
    if (!Number.isFinite(amountPaise) || amountPaise <= 0) {
      setFormError(t('suppliers.enterValidAmount'));
      return;
    }
    const applied = Math.min(amountPaise, remaining);

    if (selectedMethod === 'CREDIT') {
      if (!customer) {
        setFormError(t('pos.attachCustomerFirst'));
        return;
      }
      if (creditBreach) {
        if (creditEnforcementMode === 'BLOCK') {
          setFormError(t('pos.errCreditLimitBlock'));
          return;
        }
        if (creditEnforcementMode === 'WARN' && !warnAcknowledged) {
          setFormError(t('pos.errConfirmBreach'));
          return;
        }
        if (creditEnforcementMode === 'ALLOW_WITH_APPROVAL' && !/^\d{4,6}$/.test(approvalPin)) {
          setFormError(t('pos.errSupervisorPinRequired'));
          return;
        }
      }
      const res = addPayment({ method: 'CREDIT', amount_paise: applied });
      if (!res.ok) return setFormError(res.error ?? 'ERR_CUSTOMER_REQUIRED');
      return;
    }

    if (selectedMethod === 'CASH') {
      const tendered = Math.round(Number(tenderedInput) * 100);
      if (!Number.isFinite(tendered) || tendered < applied) {
        setFormError(t('pos.errTenderTooLow'));
        return;
      }
      const res = addPayment({ method: 'CASH', amount_paise: applied, tendered_paise: tendered, change_paise: tendered - applied });
      if (!res.ok) setFormError(res.error ?? 'ERR_QTY_INVALID');
      return;
    }

    // UPI / CARD
    const res = addPayment({ method: selectedMethod, amount_paise: applied });
    if (!res.ok) setFormError(res.error ?? 'ERR_QTY_INVALID');
  }

  async function handleComplete() {
    setFormError(null);
    setSubmitting(true);
    const cartSnapshot = usePosStore.getState(); // captured before resetCart() ever runs
    const res = await submit(totals, storeConfig.store_code);
    setSubmitting(false);
    if (!res.ok) {
      setFormError(res.error ?? 'ERR_PAYMENT_MISMATCH');
      return;
    }
    const invoiceNo = res.invoiceNo ?? 'UNKNOWN';
    const offline = res.offline ?? false;
    // Online: the server's own response (batch allocations, real cost data).
    // Offline: no server round-trip has happened yet, so this is
    // synthesized purely from local data (100% offline-safe, per spec).
    const order = res.response ?? buildLocalOrderResponse(cartSnapshot, totals, invoiceNo, storeConfig, cashierName, offline);
    setResult({ invoiceNo, offline, order });
  }

  async function handleDownloadPdf(template: PdfTemplate) {
    if (!result) return;
    const blob = await generateInvoicePdf(result.order, template);
    const filename = invoicePdfFilename(result.order, template);
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function handleShareWhatsApp() {
    if (!result) return;
    setShareStatus(t('pos.sharePreparing'));
    const blob = await generateInvoicePdf(result.order, 'THERMAL_80MM');
    const filename = invoicePdfFilename(result.order, 'THERMAL_80MM');
    const outcome = await shareReceipt(result.order, blob, filename);
    setShareStatus(outcome === 'shared' ? t('pos.shareDone') : outcome === 'opened-link' ? t('pos.shareOpenedWhatsapp') : t('pos.shareFailed'));
  }

  function handleNewSale() {
    resetCart();
    onCompleted(result?.invoiceNo ?? '');
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-white/40 p-4">
      <div className="flex max-h-[90vh] w-full max-w-lg flex-col overflow-hidden rounded-2xl border border-slate-200/80 bg-slate-50 shadow-2xl">
        <header className="flex items-center justify-between border-b border-slate-200 bg-white px-4 py-3.5">
          <h2 className="text-sm font-bold text-slate-900">{result ? t('pos.saleComplete') : t('pos.checkoutTitle')}</h2>
          <button type="button" onClick={onClose} className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700" aria-label={t('common.close')}>
            <X size={16} />
          </button>
        </header>

        {result ? (
          <ReceiptSummary
            invoiceNo={result.invoiceNo}
            offline={result.offline}
            totalPaise={totals.total_paise}
            printStatus={printStatus}
            shareStatus={shareStatus}
            onRetryPrint={() => setPrintStatus('printing')}
            onDownloadPdf={handleDownloadPdf}
            onShareWhatsApp={handleShareWhatsApp}
            onNewSale={handleNewSale}
          />
        ) : (
          <div className="flex-1 overflow-y-auto p-4">
            <div className="mb-4 flex items-center justify-between rounded-xl bg-white p-4 shadow-sm">
              <span className="text-sm font-semibold text-slate-500">{t('pos.amountDue')}</span>
              <span className="text-2xl font-black tabular-nums text-emerald-600">{formatPaise(totals.total_paise)}</span>
            </div>

            <div className="grid grid-cols-4 gap-2">
              {METHODS.map((m) => {
                const Icon = m.icon;
                return (
                  <button
                    key={m.method}
                    type="button"
                    onClick={() => setSelectedMethod(m.method)}
                    className={`flex min-h-[56px] flex-col items-center justify-center gap-1 rounded-xl border py-2 text-xs font-bold transition active:scale-95 ${
                      selectedMethod === m.method
                        ? 'border-emerald-500 bg-emerald-50 text-emerald-700 shadow-sm ring-1 ring-emerald-500'
                        : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300'
                    }`}
                  >
                    <Icon size={16} />
                    {m.label}
                  </button>
                );
              })}
            </div>

            <div className="mt-4 space-y-3 rounded-xl border border-slate-200 bg-white p-3.5">
              {selectedMethod === 'CASH' && (
                <>
                  <LabeledInput label={t('pos.tendered')} value={tenderedInput} onChange={setTenderedInput} />
                  {Number(tenderedInput) * 100 > remaining && remaining > 0 && (
                    <p className="text-xs text-emerald-600">
                      {t('pos.changeDue')}: {formatPaise(Math.round(Number(tenderedInput) * 100) - remaining)}
                    </p>
                  )}
                </>
              )}

              {(selectedMethod === 'UPI' || selectedMethod === 'CARD') && (
                <LabeledInput label={t('pos.amountRs')} value={amountInput} onChange={setAmountInput} />
              )}

              {selectedMethod === 'CREDIT' && (
                <>
                  <LabeledInput label={t('pos.amountOnKhata')} value={amountInput} onChange={setAmountInput} />
                  {!customer && <p className="text-xs text-rose-600">{t('pos.attachCustomerFirst')}</p>}
                  {customer && creditBreach && creditEnforcementMode === 'WARN' && (
                    <label className="flex items-center gap-2 text-xs text-amber-600">
                      <input type="checkbox" checked={warnAcknowledged} onChange={(e) => setWarnAcknowledged(e.target.checked)} />
                      {customer.name}{t('pos.exceedsLimitProceed')}
                    </label>
                  )}
                  {customer && creditBreach && creditEnforcementMode === 'ALLOW_WITH_APPROVAL' && (
                    <LabeledInput label={t('pos.supervisorPinOverLimit')} value={approvalPin} onChange={setApprovalPin} type="password" />
                  )}
                  {customer && creditBreach && creditEnforcementMode === 'BLOCK' && (
                    <p className="text-xs text-rose-600">{t('pos.overLimitBlocked')}</p>
                  )}
                </>
              )}

              {formError && <p className="text-xs text-rose-600">{translateError(t, formError)}</p>}

              <button
                type="button"
                onClick={handleAddPayment}
                disabled={remaining <= 0}
                className="w-full rounded-md bg-slate-100 py-2 text-sm font-semibold text-slate-900 hover:bg-slate-200 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {t('pos.addPaymentBtn')} {METHODS.find((m) => m.method === selectedMethod)?.label} {t('pos.paymentLabel')}
              </button>
            </div>

            {payments.length > 0 && (
              <ul className="mt-3 divide-y divide-slate-200 rounded-lg border border-slate-200">
                {payments.map((p, i) => (
                  <li key={i} className="flex items-center justify-between px-3 py-2 text-sm">
                    <span className="text-slate-700">
                      {METHODS.find((m) => m.method === p.method)?.label ?? p.method}
                      {p.method === 'CASH' && p.change_paise ? ` (${t('pos.changeDue')} ${formatPaise(p.change_paise)})` : ''}
                    </span>
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-slate-900">{formatPaise(p.amount_paise)}</span>
                      <button type="button" onClick={() => removePayment(i)} className="text-slate-500 hover:text-rose-600">
                        ✕
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )}

            <div className="mt-3 flex items-center justify-between text-sm">
              <span className="text-slate-500">{fullyPaid ? t('pos.fullyPaid') : t('pos.remaining')}</span>
              {!fullyPaid && <span className="font-semibold text-amber-600">{formatPaise(remaining)}</span>}
            </div>
          </div>
        )}

        {!result && (
          <footer className="border-t border-slate-200 bg-white p-4">
            <button
              type="button"
              onClick={handleComplete}
              disabled={!fullyPaid || submitting}
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-emerald-500 to-emerald-600 py-3.5 text-sm font-bold text-white shadow-lg shadow-emerald-500/25 transition hover:shadow-emerald-500/40 active:scale-[0.98] disabled:cursor-not-allowed disabled:from-slate-100 disabled:to-slate-100 disabled:text-slate-500 disabled:shadow-none"
            >
              {submitting && <Loader2 size={16} className="animate-spin" />}
              {submitting ? t('pos.completingSale') : `${t('pos.completeSale')} · ${formatPaise(totals.total_paise)}`}
            </button>
          </footer>
        )}
      </div>
    </div>
  );
}

function LabeledInput({
  label,
  value,
  onChange,
  type = 'text',
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
}) {
  return (
    <label className="block text-xs text-slate-500">
      {label}
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        inputMode={type === 'password' ? undefined : 'decimal'}
        type={type}
        className="mt-1 w-full rounded border border-slate-300 bg-white px-2 py-1.5 text-sm text-slate-900 focus:border-emerald-500 focus:outline-none"
      />
    </label>
  );
}

function ReceiptSummary({
  invoiceNo,
  offline,
  totalPaise,
  printStatus,
  shareStatus,
  onRetryPrint,
  onDownloadPdf,
  onShareWhatsApp,
  onNewSale,
}: {
  invoiceNo: string;
  offline: boolean;
  totalPaise: number;
  printStatus: PrintStatus;
  shareStatus: string | null;
  onRetryPrint: () => void;
  onDownloadPdf: (template: PdfTemplate) => void;
  onShareWhatsApp: () => void;
  onNewSale: () => void;
}) {
  const { t } = useLanguage();
  return (
    <div className="flex-1 space-y-4 p-6 text-center">
      <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-gradient-to-br from-emerald-500 to-emerald-600 text-white shadow-lg shadow-emerald-500/30">
        <CheckCircle2 size={28} strokeWidth={2.25} />
      </div>
      <div>
        {offline && (
          <p className="mb-1 inline-block rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-semibold text-amber-700">
            {t('pos.provisionalBadge')}
          </p>
        )}
        <p className="text-sm font-medium text-slate-500">{offline ? t('pos.provisionalNo') : t('pos.invoice')}</p>
        <p className="font-mono text-lg font-bold text-slate-900">{invoiceNo}</p>
        <p className="mt-1 text-2xl font-black tabular-nums text-emerald-600">{formatPaise(totalPaise)}</p>
        <p className="text-xs text-slate-400">{t('pos.settledLabel')}</p>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-3 text-sm">
        {printStatus === 'printing' && (
          <p className="flex items-center justify-center gap-2 text-slate-500">
            <Loader2 size={14} className="animate-spin" /> {t('pos.sendingToPrinter')}
          </p>
        )}
        {printStatus === 'done' && (
          <p className="flex items-center justify-center gap-1.5 font-semibold text-emerald-600">
            <CheckCircle2 size={14} /> {t('pos.receiptPrinted')}
          </p>
        )}
        {printStatus === 'failed' && (
          <div className="flex items-center justify-between">
            <p className="text-rose-600">{t('pos.printFailed')}</p>
            <button type="button" onClick={onRetryPrint} className="rounded-lg bg-slate-100 px-2.5 py-1.5 text-xs font-semibold text-slate-900 hover:bg-slate-200">
              {t('pos.reprint')}
            </button>
          </div>
        )}
      </div>

      <div className="grid grid-cols-2 gap-2">
        <button
          type="button"
          onClick={() => onDownloadPdf('A4_TAX_INVOICE')}
          className="flex items-center justify-center gap-1.5 rounded-xl border border-slate-200 bg-white py-2.5 text-xs font-bold text-slate-700 transition hover:bg-slate-50 active:scale-[0.98]"
        >
          <Printer size={14} />
          {t('pos.pdfA4')}
        </button>
        <button
          type="button"
          onClick={() => onDownloadPdf('THERMAL_80MM')}
          className="flex items-center justify-center gap-1.5 rounded-xl border border-slate-200 bg-white py-2.5 text-xs font-bold text-slate-700 transition hover:bg-slate-50 active:scale-[0.98]"
        >
          <Printer size={14} />
          {t('pos.pdfSlip')}
        </button>
      </div>
      <button
        type="button"
        onClick={onShareWhatsApp}
        className="flex w-full items-center justify-center gap-1.5 rounded-xl border border-emerald-500 py-2.5 text-xs font-bold text-emerald-700 transition hover:bg-emerald-50 active:scale-[0.98]"
      >
        <MessageCircle size={14} />
        {t('pos.shareWhatsapp')}
      </button>
      {shareStatus && <p className="text-xs text-slate-500">{shareStatus}</p>}

      <button
        type="button"
        onClick={onNewSale}
        className="w-full rounded-xl bg-gradient-to-r from-emerald-500 to-emerald-600 py-3.5 text-sm font-bold text-white shadow-lg shadow-emerald-500/25 transition hover:shadow-emerald-500/40 active:scale-[0.98]"
      >
        {t('pos.newSale')}
      </button>
    </div>
  );
}
