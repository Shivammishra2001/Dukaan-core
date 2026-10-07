'use client';

import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, PackagePlus, Plus, ShoppingCart, Trash2 } from 'lucide-react';
import { bookB2bOrder, listPurchasableProducts } from '@/lib/b2b-client';
import { listCustomers } from '@/lib/customer-client';
import { formatPaise } from '@/lib/money';
import { useLanguage } from '@/context/LanguageContext';
import { translateEnum, translateError } from '@/lib/translations';
import type { CustomerCreditInfo } from '@/types/b2b';
import type { CustomerLite } from '@/types/customer';
import type { Product } from '@/types/pos';

interface CartLine {
  key: string;
  productId: string;
  enteredQty: string;
  enteredUnit: string;
  manualPriceRupees: string; // empty = auto tiered rate
}

function uuid(): string {
  return crypto.randomUUID();
}

/** Client-side preview only — mirrors backend/src/api/b2b-dispatch/services/b2b-dispatch.ts's selectWholesaleRatePaise(); the server always recomputes and is authoritative. */
function previewTierRatePaise(product: Product, enteredQty: string, enteredUnit: string): { ratePaise: number; tier: 'TIER_1' | 'TIER_2' | 'RETAIL' } {
  const enteredConv = product.unit_conversions.find((c) => c.unit_code === enteredUnit);
  const purchaseConv = product.unit_conversions.find((c) => c.unit_code === product.default_purchase_unit);
  const qty = Number(enteredQty) || 0;
  const qtyBase = enteredConv ? qty * enteredConv.factor_to_base : qty;
  const qtyInPurchaseUnit = purchaseConv ? qtyBase / purchaseConv.factor_to_base : qtyBase;

  if (qtyInPurchaseUnit >= 20) {
    const rate = product.wholesale_tier2_rate_paise ?? product.wholesale_tier1_rate_paise ?? product.sell_rate_paise;
    return { ratePaise: rate, tier: 'TIER_2' };
  }
  if (qtyInPurchaseUnit >= 5) {
    const rate = product.wholesale_tier1_rate_paise ?? product.sell_rate_paise;
    return { ratePaise: rate, tier: 'TIER_1' };
  }
  return { ratePaise: product.sell_rate_paise, tier: 'RETAIL' };
}

export default function B2bOrderBookingPage() {
  const { t } = useLanguage();
  const TIER_LABELS: Record<string, string> = { TIER_1: t('orders.tier1'), TIER_2: t('orders.tier2'), RETAIL: t('orders.retailRate') };
  const [customers, setCustomers] = useState<CustomerLite[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [customerId, setCustomerId] = useState('');
  const [route, setRoute] = useState('');
  const [lines, setLines] = useState<CartLine[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<{ totalPaise: number; credit: CustomerCreditInfo } | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void Promise.all([listCustomers(), listPurchasableProducts()]).then(([custRes, prodRes]) => {
      if (cancelled) return;
      setLoading(false);
      if (!custRes.ok) return setError(custRes.error);
      if (!prodRes.ok) return setError(prodRes.error);
      setCustomers(custRes.data.filter((c) => c.is_active));
      setProducts(prodRes.data);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const selectedCustomer = customers.find((c) => c.id === customerId) ?? null;

  function addLine() {
    setLines((prev) => [...prev, { key: uuid(), productId: '', enteredQty: '1', enteredUnit: '', manualPriceRupees: '' }]);
  }

  function updateLine(key: string, patch: Partial<CartLine>) {
    setLines((prev) => prev.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  }

  function removeLine(key: string) {
    setLines((prev) => prev.filter((l) => l.key !== key));
  }

  function productFor(id: string): Product | undefined {
    return products.find((p) => p.id === id);
  }

  const previewTotalPaise = useMemo(() => {
    return lines.reduce((sum, l) => {
      const product = productFor(l.productId);
      if (!product) return sum;
      const qty = Number(l.enteredQty) || 0;
      const rate = l.manualPriceRupees.trim() !== '' ? Math.round(Number(l.manualPriceRupees) * 100) : previewTierRatePaise(product, l.enteredQty, l.enteredUnit).ratePaise;
      return sum + qty * rate;
    }, 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lines, products]);

  async function handleSubmit() {
    if (!customerId || lines.length === 0) {
      setError(t('orders.selectCustomerAndItem'));
      return;
    }
    setSubmitting(true);
    setError(null);
    const clientUuid = uuid();
    const res = await bookB2bOrder({
      client_uuid: clientUuid,
      customer_id: customerId,
      route: route.trim() || undefined,
      items: lines
        .filter((l) => l.productId && Number(l.enteredQty) > 0)
        .map((l) => ({
          product_id: l.productId,
          entered_qty: l.enteredQty,
          entered_unit: l.enteredUnit,
          unit_price_paise: l.manualPriceRupees.trim() !== '' ? Math.round(Number(l.manualPriceRupees) * 100) : undefined,
        })),
    });
    setSubmitting(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    setResult({ totalPaise: Number(res.data.order.total_paise), credit: res.data.customer_credit });
    setLines([]);
  }

  return (
    <div className="w-full max-w-none px-4 py-6 sm:px-6 lg:px-8">
      <div className="flex items-center gap-3">
        <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-gradient-to-br from-primary to-indigo-600 text-white shadow-sm">
          <ShoppingCart size={20} />
        </span>
        <div>
          <h1 className="text-lg font-bold text-slate-900">{t('orders.title')}</h1>
          <p className="text-sm text-slate-500">{t('orders.subtitle')}</p>
        </div>
      </div>

      {error && <p className="mt-3 rounded-xl bg-rose-50 px-4 py-2.5 text-sm text-rose-700">{translateError(t, error)}</p>}
      {loading && <p className="mt-4 text-sm text-slate-500">{t('common.loading')}</p>}

      {result && (
        <div className="mt-4 rounded-2xl border border-emerald-200 bg-emerald-50 p-4">
          <p className="text-sm font-bold text-emerald-800">{t('orders.orderBooked')} {formatPaise(result.totalPaise)}</p>
          <p className="mt-1 text-xs text-emerald-700">
            {t('orders.customerBalance')}: {formatPaise(result.credit.balance_before_paise)} → {formatPaise(result.credit.balance_after_paise)}
            {result.credit.credit_limit_enabled && <> · {t('orders.limit')} {formatPaise(result.credit.credit_limit_paise)}</>}
          </p>
          {result.credit.would_exceed_limit && (
            <p className="mt-1.5 flex items-center gap-1.5 text-xs font-semibold text-amber-700">
              <AlertTriangle size={13} /> {t('orders.overLimitWarning')}
            </p>
          )}
        </div>
      )}

      {!loading && (
        <div className="mt-4 grid gap-4 lg:grid-cols-3">
          <div className="rounded-2xl border border-slate-200/80 bg-white p-4 shadow-sm lg:col-span-2">
            <label className="block text-xs font-semibold text-slate-600">{t('orders.customer')}</label>
            <select
              value={customerId}
              onChange={(e) => setCustomerId(e.target.value)}
              className="mt-1 min-h-[48px] w-full rounded-lg border border-slate-200 px-3 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/10"
            >
              <option value="">{t('orders.selectCustomer')}</option>
              {customers.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} {c.phone_last4 ? `(••${c.phone_last4})` : ''}
                </option>
              ))}
            </select>

            {selectedCustomer && (
              <div className="mt-2 flex flex-wrap gap-3 rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600">
                <span>
                  {t('orders.outstanding')}: <strong className={selectedCustomer.current_balance_paise > 0 ? 'text-rose-600' : 'text-emerald-600'}>{formatPaise(Math.abs(selectedCustomer.current_balance_paise))}</strong>
                </span>
                <span>
                  {t('orders.creditLimit')}:{' '}
                  <strong>{selectedCustomer.credit_limit_enabled ? formatPaise(selectedCustomer.credit_limit_paise) : t('orders.noLimit')}</strong>
                </span>
              </div>
            )}

            <label className="mt-3 block text-xs font-semibold text-slate-600">{t('orders.routeZone')}</label>
            <input
              value={route}
              onChange={(e) => setRoute(e.target.value)}
              placeholder={t('orders.routePlaceholder')}
              className="mt-1 min-h-[44px] w-full rounded-lg border border-slate-200 px-3 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/10"
            />

            <div className="mt-4 flex items-center justify-between">
              <p className="text-xs font-bold uppercase tracking-wide text-slate-400">{t('orders.items')}</p>
              <button type="button" onClick={addLine} className="flex items-center gap-1 text-xs font-bold text-primary hover:text-primary-hover">
                <Plus size={14} /> {t('orders.addItem')}
              </button>
            </div>

            {lines.length === 0 && (
              <div className="mt-3 flex flex-col items-center gap-2 rounded-xl border border-dashed border-slate-200 px-4 py-8 text-center text-slate-400">
                <PackagePlus size={24} />
                <p className="text-sm">{t('orders.noItemsYet')}</p>
              </div>
            )}

            <div className="mt-2 space-y-2">
              {lines.map((line) => {
                const product = productFor(line.productId);
                const preview = product ? previewTierRatePaise(product, line.enteredQty, line.enteredUnit) : null;
                const stockBase = product?.stock_base ?? 0;
                const enteredConv = product?.unit_conversions.find((c) => c.unit_code === line.enteredUnit);
                const qtyBase = enteredConv ? (Number(line.enteredQty) || 0) * enteredConv.factor_to_base : Number(line.enteredQty) || 0;
                const insufficientStock = product ? qtyBase > stockBase : false;

                return (
                  <div key={line.key} className="rounded-xl border border-slate-200 p-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <select
                        value={line.productId}
                        onChange={(e) => {
                          const p = productFor(e.target.value);
                          const firstUnit = p?.unit_conversions.find((c) => c.is_sale_unit)?.unit_code ?? p?.default_purchase_unit ?? '';
                          updateLine(line.key, { productId: e.target.value, enteredUnit: firstUnit });
                        }}
                        className="min-h-[44px] flex-1 rounded-lg border border-slate-200 px-2.5 text-sm"
                      >
                        <option value="">{t('orders.selectProduct')}</option>
                        {products.map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.name} ({p.sku})
                          </option>
                        ))}
                      </select>
                      <input
                        type="number"
                        inputMode="decimal"
                        value={line.enteredQty}
                        onChange={(e) => updateLine(line.key, { enteredQty: e.target.value })}
                        className="min-h-[44px] w-20 rounded-lg border border-slate-200 px-2 text-sm"
                      />
                      <select
                        value={line.enteredUnit}
                        onChange={(e) => updateLine(line.key, { enteredUnit: e.target.value })}
                        className="min-h-[44px] w-28 rounded-lg border border-slate-200 px-2 text-sm"
                      >
                        {(product?.unit_conversions ?? []).map((c) => (
                          <option key={c.unit_code} value={c.unit_code}>
                            {translateEnum(t, 'unit', c.unit_code)}
                          </option>
                        ))}
                      </select>
                      <button type="button" onClick={() => removeLine(line.key)} className="flex h-10 w-10 items-center justify-center rounded-lg text-slate-400 hover:bg-rose-50 hover:text-rose-600">
                        <Trash2 size={15} />
                      </button>
                    </div>

                    {product && (
                      <div className="mt-2 flex flex-wrap items-center gap-3 text-xs">
                        <span className="rounded-full bg-slate-100 px-2 py-0.5 font-semibold text-slate-600">
                          {preview ? TIER_LABELS[preview.tier] : ''} — {formatPaise(preview?.ratePaise ?? 0)}/{translateEnum(t, 'unit', product.pricing_unit)}
                        </span>
                        <label className="flex items-center gap-1.5 text-slate-500">
                          {t('orders.manualOverride')}
                          <input
                            type="number"
                            inputMode="decimal"
                            value={line.manualPriceRupees}
                            onChange={(e) => updateLine(line.key, { manualPriceRupees: e.target.value })}
                            placeholder={t('orders.auto')}
                            className="w-20 rounded border border-slate-200 px-1.5 py-1"
                          />
                        </label>
                        <span className={insufficientStock ? 'font-semibold text-rose-600' : 'text-slate-400'}>
                          {t('orders.stock')}: {stockBase} {translateEnum(t, 'unit', product.base_unit)}
                          {insufficientStock && ` — ${t('orders.insufficient')}`}
                        </span>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          <div className="rounded-2xl border border-slate-200/80 bg-white p-4 shadow-sm">
            <p className="text-xs font-bold uppercase tracking-wide text-slate-400">{t('orders.orderPreview')}</p>
            <p className="mt-2 text-2xl font-black text-slate-900">{formatPaise(previewTotalPaise)}</p>
            <p className="text-xs text-slate-400">{t('orders.approxExclGst')}</p>
            <button
              type="button"
              onClick={handleSubmit}
              disabled={submitting || !customerId || lines.length === 0}
              className="mt-4 flex min-h-[48px] w-full items-center justify-center gap-1.5 rounded-xl bg-primary text-sm font-bold text-white shadow-sm hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-40"
            >
              {submitting ? t('orders.booking') : t('orders.bookOrder')}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
