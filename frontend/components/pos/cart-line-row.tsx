'use client';

import { useState } from 'react';
import { Minus, Plus, Trash2 } from 'lucide-react';
import Decimal from 'decimal.js';
import type { CartLine, Discount, UnitCode } from '@/types/pos';
import type { LineTotals } from '@/lib/pricing';
import { formatPaise } from '@/lib/money';
import { findConversion, validateEnteredQty } from '@/lib/units';
import { useLanguage } from '@/context/LanguageContext';
import { translateEnum } from '@/lib/translations';

interface CartLineRowProps {
  line: CartLine;
  totals: LineTotals | undefined;
  onQtyChange: (enteredQty: string, unit?: UnitCode) => void;
  onRemove: () => void;
  onApplyDiscount: (discount: Discount | null) => void;
  onOverridePrice: (pricePaise: number) => void;
}

export function CartLineRow({ line, totals, onQtyChange, onRemove, onApplyDiscount, onOverridePrice }: CartLineRowProps) {
  const { t } = useLanguage();
  const [editing, setEditing] = useState<'discount' | 'price' | null>(null);

  const saleUnits = line.product_snapshot.unit_conversions.filter((c) => c.is_sale_unit);
  const step = 1 / 10 ** line.product_snapshot.quantity_precision;

  function bump(direction: 1 | -1) {
    const next = new Decimal(line.entered_qty).plus(direction * step);
    if (next.lte(0)) return;
    onQtyChange(next.toString());
  }

  /**
   * The same base quantity expressed in `unitCode` — or null when it can't be
   * entered in that unit exactly under Rule UC-5 (entered_qty may have at most
   * quantity_precision decimals): e.g. 100 G of a precision-0 product is
   * 0.1 KG, which would have to be rounded to 0 KG. Rounding would silently
   * change what is billed, so such units are offered disabled instead.
   */
  function qtyInUnit(unitCode: UnitCode): string | null {
    const conv = findConversion(line.product_snapshot.unit_conversions, unitCode);
    const qty = new Decimal(line.qty_base).div(conv.factor_to_base);
    try {
      validateEnteredQty(line.product_snapshot, qty);
      return qty.toString();
    } catch {
      return null;
    }
  }

  function changeUnit(unitCode: UnitCode) {
    const qty = qtyInUnit(unitCode);
    if (qty !== null) onQtyChange(qty, unitCode);
  }

  return (
    <>
      <tr className="border-b border-slate-200/60 align-top">
        <td className="py-2 pr-2">
          <p className="font-medium leading-tight text-slate-900">{line.product_snapshot.name}</p>
          {line.product_snapshot.name_local && (
            <p className="text-xs leading-tight text-slate-500">{line.product_snapshot.name_local}</p>
          )}
          <div className="mt-0.5 flex flex-wrap gap-2">
            {line.price_source !== 'PRODUCT' && (
              <span className="text-[10px] font-medium text-amber-600">
                {line.price_source === 'MANUAL' ? t('pos.manualPrice') : t('pos.unitPrice')}
              </span>
            )}
            {line.line_discount && (
              <span className="text-[10px] font-medium text-emerald-600">
                {line.line_discount.type === 'FLAT' ? formatPaise(line.line_discount.value) : `${line.line_discount.value}%`} {t('pos.off')}
              </span>
            )}
          </div>
        </td>
        <td className="py-2 pr-2">
          <select
            value={line.entered_unit}
            onChange={(e) => changeUnit(e.target.value as UnitCode)}
            className="rounded-full border border-slate-200 bg-slate-50 px-2 py-1 text-xs font-semibold text-slate-700"
          >
            {saleUnits.map((u) => (
              <option key={u.unit_code} value={u.unit_code} disabled={u.unit_code !== line.entered_unit && qtyInUnit(u.unit_code) === null}>
                {translateEnum(t, 'unit', u.unit_code)}
              </option>
            ))}
          </select>
        </td>
        <td className="py-2 pr-2">
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => bump(-1)}
              className="flex h-7 w-7 items-center justify-center rounded-lg bg-slate-100 text-slate-700 transition hover:bg-slate-200 active:scale-90"
              aria-label={t('pos.decreaseQty')}
            >
              <Minus size={13} strokeWidth={2.5} />
            </button>
            <input
              value={line.entered_qty}
              onChange={(e) => onQtyChange(e.target.value)}
              inputMode="decimal"
              className="w-16 rounded-lg border border-slate-200 bg-white px-1.5 py-1.5 text-center text-xs font-semibold text-slate-900"
            />
            <button
              type="button"
              onClick={() => bump(1)}
              className="flex h-7 w-7 items-center justify-center rounded-lg bg-slate-100 text-slate-700 transition hover:bg-slate-200 active:scale-90"
              aria-label={t('pos.increaseQty')}
            >
              <Plus size={13} strokeWidth={2.5} />
            </button>
          </div>
        </td>
        <td className="py-2 pr-2 text-right text-xs">
          <button type="button" onClick={() => setEditing(editing === 'price' ? null : 'price')} className="text-slate-700 hover:text-emerald-600">
            {formatPaise(line.unit_price_paise)}
          </button>
        </td>
        <td className="py-2 pr-2 text-right">
          <button
            type="button"
            onClick={() => setEditing(editing === 'discount' ? null : 'discount')}
            className="text-xs text-slate-500 hover:text-emerald-600"
          >
            {t('pos.disc')}
          </button>
        </td>
        <td className="py-2 pr-2 text-right font-semibold text-slate-900">{formatPaise(totals?.line_total_paise ?? 0)}</td>
        <td className="py-2 text-right">
          <button
            type="button"
            onClick={onRemove}
            className="flex h-7 w-7 items-center justify-center rounded-lg text-slate-400 transition hover:bg-rose-50 hover:text-rose-600 active:scale-90"
            title={t('pos.removeLine')}
            aria-label={t('pos.removeLine')}
          >
            <Trash2 size={14} />
          </button>
        </td>
      </tr>
      {editing === 'discount' && (
        <tr className="border-b border-slate-200/60 bg-slate-100/70">
          <td colSpan={7} className="p-2">
            <DiscountEditor
              current={line.line_discount}
              onApply={(d) => {
                onApplyDiscount(d);
                setEditing(null);
              }}
              onCancel={() => setEditing(null)}
            />
          </td>
        </tr>
      )}
      {editing === 'price' && (
        <tr className="border-b border-slate-200/60 bg-slate-100/70">
          <td colSpan={7} className="p-2">
            <PriceEditor
              currentPaise={line.unit_price_paise}
              onApply={(paise) => {
                onOverridePrice(paise);
                setEditing(null);
              }}
              onCancel={() => setEditing(null)}
            />
          </td>
        </tr>
      )}
    </>
  );
}

function DiscountEditor({
  current,
  onApply,
  onCancel,
}: {
  current: Discount | null;
  onApply: (d: Discount | null) => void;
  onCancel: () => void;
}) {
  const { t } = useLanguage();
  const [type, setType] = useState<Discount['type']>(current?.type ?? 'PCT');
  const [value, setValue] = useState(current ? String(current.value) : '');

  return (
    <div className="flex items-center gap-2 text-xs">
      <span className="text-slate-500">{t('pos.lineDiscount')}</span>
      <select value={type} onChange={(e) => setType(e.target.value as Discount['type'])} className="rounded border border-slate-300 bg-slate-100 px-1.5 py-1">
        <option value="PCT">%</option>
        <option value="FLAT">{t('pos.flatRs')}</option>
      </select>
      <input
        value={value}
        onChange={(e) => setValue(e.target.value)}
        inputMode="decimal"
        placeholder="0"
        className="w-20 rounded border border-slate-300 bg-slate-100 px-1.5 py-1"
      />
      <button
        type="button"
        onClick={() => {
          const n = Number(value);
          if (!Number.isFinite(n) || n <= 0) return onApply(null);
          onApply({ type, value: type === 'FLAT' ? Math.round(n * 100) : n });
        }}
        className="rounded bg-emerald-600 px-2 py-1 font-semibold text-white hover:bg-emerald-500"
      >
        {t('pos.apply')}
      </button>
      {current && (
        <button type="button" onClick={() => onApply(null)} className="rounded border border-slate-300 px-2 py-1 text-slate-700 hover:bg-slate-100">
          {t('pos.clear')}
        </button>
      )}
      <button type="button" onClick={onCancel} className="text-slate-500 hover:text-slate-700">
        {t('pos.cancel')}
      </button>
    </div>
  );
}

function PriceEditor({ currentPaise, onApply, onCancel }: { currentPaise: number; onApply: (paise: number) => void; onCancel: () => void }) {
  const { t } = useLanguage();
  const [rupees, setRupees] = useState((currentPaise / 100).toFixed(2));

  return (
    <div className="flex items-center gap-2 text-xs">
      <span className="text-slate-500">{t('pos.overridePrice')}</span>
      <input
        value={rupees}
        onChange={(e) => setRupees(e.target.value)}
        inputMode="decimal"
        className="w-24 rounded border border-slate-300 bg-slate-100 px-1.5 py-1"
      />
      <button
        type="button"
        onClick={() => {
          const n = Number(rupees);
          if (!Number.isFinite(n) || n < 0) return;
          onApply(Math.round(n * 100));
        }}
        className="rounded bg-emerald-600 px-2 py-1 font-semibold text-white hover:bg-emerald-500"
      >
        {t('pos.apply')}
      </button>
      <button type="button" onClick={onCancel} className="text-slate-500 hover:text-slate-700">
        {t('pos.cancel')}
      </button>
    </div>
  );
}
