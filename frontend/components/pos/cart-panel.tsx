'use client';

import { useState } from 'react';
import { ShoppingBag } from 'lucide-react';
import { usePosStore } from '@/stores/pos-store';
import type { InvoiceTotals } from '@/lib/pricing';
import { formatPaise, formatSignedPaise } from '@/lib/money';
import { useLanguage } from '@/context/LanguageContext';
import type { CustomerLite } from '@/types/pos';
import { CartLineRow } from './cart-line-row';
import { CustomerBar } from './customer-bar';

interface CartPanelProps {
  totals: InvoiceTotals;
  customers: CustomerLite[];
  onCheckout: () => void;
  onPark: () => void;
  notify: (message: string, tone?: 'error' | 'success') => void;
}

/** The Register — line item table, bound customer, sticky bill summary, Checkout CTA. */
export function CartPanel({ totals, customers, onCheckout, onPark, notify }: CartPanelProps) {
  const { t } = useLanguage();
  const lines = usePosStore((s) => s.lines);
  const customer = usePosStore((s) => s.customer);
  const cartDiscount = usePosStore((s) => s.cart_discount);
  const setLineQty = usePosStore((s) => s.setLineQty);
  const removeLine = usePosStore((s) => s.removeLine);
  const applyLineDiscount = usePosStore((s) => s.applyLineDiscount);
  const overrideLinePrice = usePosStore((s) => s.overrideLinePrice);
  const applyCartDiscount = usePosStore((s) => s.applyCartDiscount);
  const bindCustomer = usePosStore((s) => s.bindCustomer);
  const clearCustomer = usePosStore((s) => s.clearCustomer);

  const [editingCartDiscount, setEditingCartDiscount] = useState(false);

  const totalsByLine = new Map(totals.lines.map((l) => [l.line_id, l]));

  return (
    <aside className="flex h-full w-full flex-col border-l border-slate-200 bg-slate-50">
      <CustomerBar customer={customer} directory={customers} onBind={bindCustomer} onClear={clearCustomer} />

      <div className="flex-1 overflow-y-auto">
        {lines.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center text-slate-400">
            <ShoppingBag size={32} strokeWidth={1.5} />
            <p className="text-sm font-semibold text-slate-500">{t('pos.cartEmpty')}</p>
            <p className="text-xs">{t('pos.cartEmptyHint')}</p>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-slate-50 text-left text-[10px] uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-2 py-1.5 font-medium">{t('pos.item')}</th>
                <th className="px-2 py-1.5 font-medium">{t('pos.unit')}</th>
                <th className="px-2 py-1.5 font-medium">{t('pos.qty')}</th>
                <th className="px-2 py-1.5 text-right font-medium">{t('pos.price')}</th>
                <th className="px-2 py-1.5" />
                <th className="px-2 py-1.5 text-right font-medium">{t('pos.total')}</th>
                <th className="px-2 py-1.5" />
              </tr>
            </thead>
            <tbody>
              {lines.map((line) => (
                <CartLineRow
                  key={line.line_id}
                  line={line}
                  totals={totalsByLine.get(line.line_id)}
                  onQtyChange={(qty, unit) => {
                    const res = setLineQty(line.line_id, qty, unit);
                    if (!res.ok) notify(res.error ?? 'ERR_QTY_INVALID', 'error');
                  }}
                  onRemove={() => removeLine(line.line_id)}
                  onApplyDiscount={(d) => {
                    const res = applyLineDiscount(line.line_id, d);
                    if (!res.ok) notify(res.error ?? 'ERR_DISCOUNT_EXCEEDS_LINE', 'error');
                  }}
                  onOverridePrice={(paise) => {
                    const res = overrideLinePrice(line.line_id, paise);
                    if (!res.ok) notify(res.error ?? 'ERR_PRICE_ABOVE_MRP', 'error');
                  }}
                />
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="shrink-0 space-y-2 border-t border-slate-200 bg-white p-3">
        <button
          id="cart-discount-trigger"
          type="button"
          onClick={() => setEditingCartDiscount((v) => !v)}
          className="flex w-full items-center justify-between text-xs text-slate-500 hover:text-emerald-600"
        >
          <span>
            {t('pos.cartDiscount')} <kbd className="text-[10px] text-slate-400">F6</kbd>
          </span>
          <span>{cartDiscount ? (cartDiscount.type === 'FLAT' ? formatPaise(cartDiscount.value) : `${cartDiscount.value}%`) : t('pos.none')}</span>
        </button>
        {editingCartDiscount && (
          <CartDiscountEditor
            current={cartDiscount}
            onApply={(d) => {
              const res = applyCartDiscount(d);
              if (!res.ok) notify(res.error ?? 'ERR_DISCOUNT_ABOVE_ROLE_CAP', 'error');
              else setEditingCartDiscount(false);
            }}
          />
        )}

        <dl className="space-y-1 text-sm">
          <Row label={t('pos.subtotalTaxable')} value={formatPaise(totals.taxable_value_paise)} />
          <Row
            label={t('pos.discounts')}
            value={
              totals.line_discount_paise + totals.cart_discount_paise > 0
                ? `− ${formatPaise(totals.line_discount_paise + totals.cart_discount_paise)}`
                : formatPaise(0)
            }
          />
          <Row label={totals.igst_paise > 0 ? t('b2b.igst') : `${t('b2b.cgst')} + ${t('b2b.sgst')}`} value={formatPaise(totals.tax_paise)} />
          {totals.round_off_paise !== 0 && <Row label={t('pos.roundOff')} value={formatSignedPaise(totals.round_off_paise)} />}
          <div className="flex items-center justify-between border-t border-slate-200 pt-2">
            <span className="text-sm font-semibold text-slate-600">{t('pos.grandTotal')}</span>
            <span className="text-xl font-black tabular-nums text-emerald-600">{formatPaise(totals.total_paise)}</span>
          </div>
        </dl>

        <div className="flex gap-2 pt-1">
          <button
            type="button"
            onClick={onPark}
            disabled={lines.length === 0}
            className="min-h-[48px] flex-1 rounded-xl border border-slate-200 text-sm font-semibold text-slate-700 transition hover:bg-slate-100 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40"
          >
            {t('pos.park')} <kbd className="text-[10px] text-slate-400">F8</kbd>
          </button>
          <button
            type="button"
            onClick={onCheckout}
            disabled={lines.length === 0}
            className="min-h-[48px] flex-[2] rounded-xl bg-gradient-to-r from-emerald-500 to-emerald-600 text-sm font-bold text-white shadow-md shadow-emerald-500/25 transition hover:shadow-emerald-500/40 active:scale-[0.98] disabled:cursor-not-allowed disabled:from-slate-100 disabled:to-slate-100 disabled:text-slate-500 disabled:shadow-none"
          >
            {t('pos.checkout')} · {formatPaise(totals.total_paise)} <kbd className="text-[10px] opacity-70">F4</kbd>
          </button>
        </div>
      </div>
    </aside>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between text-slate-500">
      <span>{label}</span>
      <span className="text-slate-800">{value}</span>
    </div>
  );
}

function CartDiscountEditor({
  current,
  onApply,
}: {
  current: { type: 'FLAT' | 'PCT'; value: number } | null;
  onApply: (d: { type: 'FLAT' | 'PCT'; value: number } | null) => void;
}) {
  const { t } = useLanguage();
  const [type, setType] = useState<'FLAT' | 'PCT'>(current?.type ?? 'PCT');
  const [value, setValue] = useState(current ? String(current.value) : '');

  return (
    <div className="flex items-center gap-2 rounded-md bg-slate-100 p-2 text-xs">
      <select value={type} onChange={(e) => setType(e.target.value as 'FLAT' | 'PCT')} className="rounded border border-slate-300 bg-white px-1.5 py-1">
        <option value="PCT">%</option>
        <option value="FLAT">{t('pos.flatRs')}</option>
      </select>
      <input
        value={value}
        onChange={(e) => setValue(e.target.value)}
        inputMode="decimal"
        placeholder="0"
        className="w-full rounded border border-slate-300 bg-white px-1.5 py-1"
      />
      <button
        type="button"
        onClick={() => {
          const n = Number(value);
          if (!Number.isFinite(n) || n <= 0) return onApply(null);
          onApply({ type, value: type === 'FLAT' ? Math.round(n * 100) : n });
        }}
        className="shrink-0 rounded bg-emerald-600 px-2 py-1 font-semibold text-white hover:bg-emerald-500"
      >
        {t('pos.apply')}
      </button>
      {current && (
        <button type="button" onClick={() => onApply(null)} className="shrink-0 rounded border border-slate-300 px-2 py-1 text-slate-700 hover:bg-white">
          {t('pos.clear')}
        </button>
      )}
    </div>
  );
}
