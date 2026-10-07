'use client';

import { useEffect, useMemo, useState } from 'react';
import { Boxes, FileDown, Pencil, Plus, Search, UploadCloud, X } from 'lucide-react';
import { createProduct, listProducts, updateProductRates } from '@/lib/inventory-client';
import { formatPaise } from '@/lib/money';
import { useLanguage } from '@/context/LanguageContext';
import { translateEnum, translateError } from '@/lib/translations';
import type { BaseUnit, ProductRow } from '@/types/inventory';
import { BulkImportModal } from '@/components/inventory/bulk-import-modal';

const BASE_UNITS: BaseUnit[] = ['G', 'ML', 'PCS'];

function paiseToRupeeInput(paise: number | null): string {
  return paise == null ? '' : (paise / 100).toString();
}

function rupeeInputToPaise(value: string): number | undefined {
  if (value.trim() === '') return undefined;
  const n = Number(value);
  return Number.isFinite(n) ? Math.round(n * 100) : undefined;
}

function EditRatesModal({ product, onClose, onSaved }: { product: ProductRow; onClose: () => void; onSaved: (p: ProductRow) => void }) {
  const { t } = useLanguage();
  const [mrp, setMrp] = useState(paiseToRupeeInput(product.mrp_paise));
  const [sellRate, setSellRate] = useState(paiseToRupeeInput(product.sell_rate_paise));
  const [tier1, setTier1] = useState(paiseToRupeeInput(product.wholesale_tier1_rate_paise));
  const [tier2, setTier2] = useState(paiseToRupeeInput(product.wholesale_tier2_rate_paise));
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit() {
    setSubmitting(true);
    setError(null);
    const res = await updateProductRates(product.id, {
      mrp_paise: rupeeInputToPaise(mrp),
      sell_rate_paise: rupeeInputToPaise(sellRate),
      wholesale_tier1_rate_paise: tier1.trim() === '' ? null : (rupeeInputToPaise(tier1) ?? null),
      wholesale_tier2_rate_paise: tier2.trim() === '' ? null : (rupeeInputToPaise(tier2) ?? null),
    });
    setSubmitting(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    onSaved(res.data);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/40 p-0 backdrop-blur-sm sm:items-center sm:p-4">
      <div className="w-full max-w-sm rounded-t-2xl bg-white p-5 shadow-2xl sm:rounded-2xl">
        <div className="flex items-start justify-between">
          <div>
            <h2 className="text-base font-bold text-slate-900">{t('inventory.editRatesTitle')}</h2>
            <p className="text-xs text-slate-500">{product.name}</p>
          </div>
          <button onClick={onClose} className="flex h-9 w-9 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100">
            <X size={18} />
          </button>
        </div>

        <label className="mt-4 block text-xs font-semibold text-slate-600">{t('inventory.costPrice')}</label>
        <p className="mt-1 min-h-[44px] rounded-lg bg-slate-50 px-3 py-2.5 text-sm text-slate-500">
          {product.last_cost_paise != null ? formatPaise(product.last_cost_paise) : t('inventory.noPurchaseRecorded')}
        </p>

        <label className="mt-3 block text-xs font-semibold text-slate-600">{t('inventory.mrpRs')}</label>
        <input
          type="number"
          inputMode="decimal"
          value={mrp}
          onChange={(e) => setMrp(e.target.value)}
          className="mt-1 min-h-[48px] w-full rounded-lg border border-slate-200 px-3 text-sm font-semibold outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
        />

        <label className="mt-3 block text-xs font-semibold text-slate-600">{t('inventory.retailPosRate')}</label>
        <input
          type="number"
          inputMode="decimal"
          value={sellRate}
          onChange={(e) => setSellRate(e.target.value)}
          className="mt-1 min-h-[48px] w-full rounded-lg border border-slate-200 px-3 text-sm font-semibold outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
        />

        <div className="mt-4 border-t border-slate-100 pt-3">
          <p className="text-xs font-bold uppercase tracking-wide text-slate-400">{t('inventory.wholesaleTiers')}</p>
          <label className="mt-2 block text-xs font-semibold text-slate-600">{t('inventory.tier1Rate')} {product.pricing_unit === product.default_sale_unit ? '' : 'cartons'}</label>
          <input
            type="number"
            inputMode="decimal"
            value={tier1}
            onChange={(e) => setTier1(e.target.value)}
            placeholder={t('inventory.tier1Fallback')}
            className="mt-1 min-h-[48px] w-full rounded-lg border border-slate-200 px-3 text-sm font-semibold outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
          />
          <label className="mt-3 block text-xs font-semibold text-slate-600">{t('inventory.tier2Rate')}</label>
          <input
            type="number"
            inputMode="decimal"
            value={tier2}
            onChange={(e) => setTier2(e.target.value)}
            placeholder={t('inventory.tier2Fallback')}
            className="mt-1 min-h-[48px] w-full rounded-lg border border-slate-200 px-3 text-sm font-semibold outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
          />
        </div>

        {error && <p className="mt-2 text-xs font-medium text-rose-600">{translateError(t, error)}</p>}

        <div className="mt-5 flex gap-2">
          <button type="button" onClick={onClose} className="min-h-[48px] flex-1 rounded-lg border border-slate-200 text-sm font-semibold text-slate-600 hover:bg-slate-50">
            {t('common.cancel')}
          </button>
          <button
            type="button"
            disabled={submitting}
            onClick={handleSubmit}
            className="min-h-[48px] flex-1 rounded-lg bg-primary text-sm font-bold text-white shadow-sm shadow-primary/25 hover:bg-primary-hover disabled:opacity-50"
          >
            {submitting ? t('inventory.saving') : t('inventory.saveRates')}
          </button>
        </div>
      </div>
    </div>
  );
}

function AddProductModal({ onClose, onCreated }: { onClose: () => void; onCreated: (p: ProductRow) => void }) {
  const { t } = useLanguage();
  const [name, setName] = useState('');
  const [sku, setSku] = useState('');
  const [isService, setIsService] = useState(false);
  const [baseUnit, setBaseUnit] = useState<BaseUnit>('PCS');
  const [unit, setUnit] = useState('PCS');
  const [sellRate, setSellRate] = useState('');
  const [mrp, setMrp] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit() {
    const sellRatePaise = rupeeInputToPaise(sellRate);
    if (!name.trim() || !sku.trim() || !sellRatePaise) {
      setError(t('inventory.nameRequired'));
      return;
    }
    setSubmitting(true);
    setError(null);
    const res = await createProduct({
      sku: sku.trim(),
      name: name.trim(),
      base_unit: baseUnit,
      default_sale_unit: unit.trim() || baseUnit,
      default_purchase_unit: unit.trim() || baseUnit,
      pricing_unit: unit.trim() || baseUnit,
      sell_rate_paise: sellRatePaise,
      mrp_paise: rupeeInputToPaise(mrp),
      is_service: isService,
    });
    setSubmitting(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    onCreated(res.data);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/40 p-0 backdrop-blur-sm sm:items-center sm:p-4">
      <div className="max-h-[90vh] w-full max-w-sm overflow-y-auto rounded-t-2xl bg-white p-5 shadow-2xl sm:rounded-2xl">
        <div className="flex items-start justify-between">
          <h2 className="text-base font-bold text-slate-900">{t('inventory.addProductServiceModalTitle')}</h2>
          <button onClick={onClose} className="flex h-9 w-9 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100">
            <X size={18} />
          </button>
        </div>

        <div className="mt-3 flex gap-2">
          <button
            type="button"
            onClick={() => setIsService(false)}
            className={`min-h-[44px] flex-1 rounded-lg border text-sm font-semibold ${!isService ? 'border-primary bg-primary/10 text-primary' : 'border-slate-200 text-slate-600'}`}
          >
            {t('inventory.product2')}
          </button>
          <button
            type="button"
            onClick={() => setIsService(true)}
            className={`min-h-[44px] flex-1 rounded-lg border text-sm font-semibold ${isService ? 'border-primary bg-primary/10 text-primary' : 'border-slate-200 text-slate-600'}`}
          >
            {t('inventory.service')}
          </button>
        </div>

        <label className="mt-3 block text-xs font-semibold text-slate-600">{t('inventory.name')}</label>
        <input value={name} onChange={(e) => setName(e.target.value)} className="mt-1 min-h-[48px] w-full rounded-lg border border-slate-200 px-3 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/20" />

        <label className="mt-3 block text-xs font-semibold text-slate-600">{t('inventory.sku')}</label>
        <input value={sku} onChange={(e) => setSku(e.target.value)} className="mt-1 min-h-[48px] w-full rounded-lg border border-slate-200 px-3 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/20" />

        {!isService && (
          <>
            <label className="mt-3 block text-xs font-semibold text-slate-600">{t('inventory.baseUnit')}</label>
            <div className="mt-1 grid grid-cols-3 gap-2">
              {BASE_UNITS.map((u) => (
                <button
                  key={u}
                  type="button"
                  onClick={() => setBaseUnit(u)}
                  className={`min-h-[44px] rounded-lg border text-xs font-semibold ${baseUnit === u ? 'border-primary bg-primary/10 text-primary' : 'border-slate-200 text-slate-600'}`}
                >
                  {translateEnum(t, 'unit', u)}
                </button>
              ))}
            </div>
          </>
        )}

        <label className="mt-3 block text-xs font-semibold text-slate-600">{t('inventory.salePricingUnit')}</label>
        <input value={unit} onChange={(e) => setUnit(e.target.value)} placeholder={t('inventory.unitPlaceholder')} className="mt-1 min-h-[48px] w-full rounded-lg border border-slate-200 px-3 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/20" />

        <label className="mt-3 block text-xs font-semibold text-slate-600">{t('inventory.sellingRate')}</label>
        <input type="number" inputMode="decimal" value={sellRate} onChange={(e) => setSellRate(e.target.value)} className="mt-1 min-h-[48px] w-full rounded-lg border border-slate-200 px-3 text-sm font-semibold outline-none focus:border-primary focus:ring-2 focus:ring-primary/20" />

        <label className="mt-3 block text-xs font-semibold text-slate-600">{t('inventory.mrpOptional')}</label>
        <input type="number" inputMode="decimal" value={mrp} onChange={(e) => setMrp(e.target.value)} className="mt-1 min-h-[48px] w-full rounded-lg border border-slate-200 px-3 text-sm font-semibold outline-none focus:border-primary focus:ring-2 focus:ring-primary/20" />

        {error && <p className="mt-2 text-xs font-medium text-rose-600">{translateError(t, error)}</p>}

        <div className="mt-5 flex gap-2">
          <button type="button" onClick={onClose} className="min-h-[48px] flex-1 rounded-lg border border-slate-200 text-sm font-semibold text-slate-600 hover:bg-slate-50">
            {t('common.cancel')}
          </button>
          <button
            type="button"
            disabled={submitting}
            onClick={handleSubmit}
            className="min-h-[48px] flex-1 rounded-lg bg-primary text-sm font-bold text-white shadow-sm shadow-primary/25 hover:bg-primary-hover disabled:opacity-50"
          >
            {submitting ? t('inventory.saving') : t('common.add')}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function InventoryPage() {
  const { t } = useLanguage();
  const [products, setProducts] = useState<ProductRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [editing, setEditing] = useState<ProductRow | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void listProducts().then((res) => {
      if (cancelled) return;
      setLoading(false);
      if (!res.ok) return setError(res.error);
      setError(null);
      setProducts(res.data);
    });
    return () => {
      cancelled = true;
    };
  }, [reloadKey]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return products;
    return products.filter((p) => p.name.toLowerCase().includes(q) || p.sku.toLowerCase().includes(q) || p.name_local?.toLowerCase().includes(q));
  }, [products, query]);

  function replaceProduct(updated: ProductRow) {
    setProducts((prev) => {
      const exists = prev.some((p) => p.id === updated.id);
      return exists ? prev.map((p) => (p.id === updated.id ? { ...p, ...updated } : p)) : [updated, ...prev];
    });
  }

  return (
    <div className="w-full max-w-none px-4 py-4 sm:px-6 sm:py-6 lg:px-8">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-lg font-bold text-slate-900">{t('inventory.title')}</h1>
          <p className="mt-1 text-sm text-slate-500">{t('inventory.subtitle')}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex overflow-hidden rounded-lg border border-slate-200 bg-white">
            <a
              href="/api/inventory/template?format=xlsx"
              download
              className="flex min-h-[48px] items-center gap-1.5 px-3 text-sm font-semibold text-slate-700 hover:bg-slate-50"
            >
              <FileDown size={16} className="text-emerald-600" /> {t('import.downloadTemplate')}
            </a>
            <a
              href="/api/inventory/template?format=csv"
              download
              title={t('import.downloadTemplateCsv')}
              className="flex min-h-[48px] items-center border-l border-slate-200 px-2.5 text-xs font-bold text-slate-500 hover:bg-slate-50"
            >
              CSV
            </a>
          </div>
          <button
            type="button"
            onClick={() => setImportOpen(true)}
            className="flex min-h-[48px] items-center gap-1.5 rounded-lg border border-primary/30 bg-primary/10 px-4 text-sm font-bold text-primary hover:bg-primary/15"
          >
            <UploadCloud size={16} /> {t('import.uploadButton')}
          </button>
          <button
            type="button"
            onClick={() => setAddOpen(true)}
            className="flex min-h-[48px] items-center gap-1.5 rounded-lg bg-primary px-4 text-sm font-bold text-white shadow-sm shadow-primary/25 hover:bg-primary-hover"
          >
            <Plus size={16} /> {t('inventory.addProductService')}
          </button>
        </div>
      </div>

      <div className="relative mt-4">
        <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t('inventory.searchByNameSku')}
          className="min-h-[48px] w-full rounded-lg border border-slate-200 bg-white py-2.5 pl-9 pr-3 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
        />
      </div>

      {error && <p className="mt-4 text-sm text-rose-600">{t('inventory.couldNotLoadProducts')} ({translateError(t, error)}).</p>}
      {loading && <p className="mt-4 text-sm text-slate-500">{t('common.loading')}</p>}

      {!loading && !error && (
        <div className="mt-4 overflow-x-auto rounded-xl border border-slate-200 bg-white">
          {filtered.length === 0 ? (
            <div className="flex flex-col items-center gap-2 px-4 py-10 text-center text-slate-400">
              <Boxes size={28} />
              <p className="text-sm">{t('inventory.noProductsYet')}</p>
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
                <tr>
                  <th className="px-3 py-2">{t('inventory.product')}</th>
                  <th className="px-3 py-2 text-right">{t('inventory.mrp')}</th>
                  <th className="px-3 py-2 text-right">{t('inventory.cost')}</th>
                  <th className="px-3 py-2 text-right">{t('inventory.retailRate')}</th>
                  <th className="px-3 py-2 text-right">{t('inventory.tier1')}</th>
                  <th className="px-3 py-2 text-right">{t('inventory.tier2')}</th>
                  <th className="px-3 py-2 text-right">{t('inventory.stock')}</th>
                  <th className="px-3 py-2 text-right">{t('inventory.edit')}</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((p) => (
                  <tr key={p.id} className="border-t border-slate-100">
                    <td className="px-3 py-2.5">
                      <p className="font-semibold text-slate-900">{p.name}</p>
                      <p className="text-xs text-slate-500">
                        {p.sku} {p.is_service ? `· ${t('inventory.service')}` : ''}
                      </p>
                    </td>
                    <td className="px-3 py-2.5 text-right text-slate-600">{p.mrp_paise != null ? formatPaise(p.mrp_paise) : '—'}</td>
                    <td className="px-3 py-2.5 text-right text-slate-600">{p.last_cost_paise != null ? formatPaise(p.last_cost_paise) : '—'}</td>
                    <td className="px-3 py-2.5 text-right font-semibold text-slate-900">{formatPaise(p.sell_rate_paise)}</td>
                    <td className="px-3 py-2.5 text-right text-slate-600">{p.wholesale_tier1_rate_paise != null ? formatPaise(p.wholesale_tier1_rate_paise) : '—'}</td>
                    <td className="px-3 py-2.5 text-right text-slate-600">{p.wholesale_tier2_rate_paise != null ? formatPaise(p.wholesale_tier2_rate_paise) : '—'}</td>
                    <td className="px-3 py-2.5 text-right">
                      {p.is_service ? (
                        <span className="text-slate-400">—</span>
                      ) : (
                        <span className={Number(p.current_stock_base) <= 0 ? 'font-semibold text-rose-600' : 'text-slate-700'}>
                          {p.current_stock_base} {translateEnum(t, 'unit', p.base_unit)}
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2.5 text-right">
                      <button
                        type="button"
                        onClick={() => setEditing(p)}
                        className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                        aria-label={`${t('inventory.editRatesTitle')} — ${p.name}`}
                      >
                        <Pencil size={16} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {editing && (
        <EditRatesModal
          product={editing}
          onClose={() => setEditing(null)}
          onSaved={(p) => {
            replaceProduct(p);
            setEditing(null);
          }}
        />
      )}
      {importOpen && <BulkImportModal onClose={() => setImportOpen(false)} onImported={() => setReloadKey((k) => k + 1)} />}
      {addOpen && (
        <AddProductModal
          onClose={() => setAddOpen(false)}
          onCreated={(p) => {
            replaceProduct(p);
            setAddOpen(false);
          }}
        />
      )}
    </div>
  );
}
