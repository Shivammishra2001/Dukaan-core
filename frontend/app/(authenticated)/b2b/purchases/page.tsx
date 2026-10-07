'use client';

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { CheckCircle2, ChevronDown, PackagePlus, Plus, Search, Trash2, X } from 'lucide-react';
import Decimal from 'decimal.js';
import { toBase, findConversion } from '@/lib/units';
import { roundPaise, formatPaise } from '@/lib/money';
import { submitPurchaseInward, listPurchasableProducts, createPurchasableProduct, listSuppliers, createSupplier } from '@/lib/b2b-client';
import { useLanguage } from '@/context/LanguageContext';
import { translateEnum, translateError } from '@/lib/translations';
import type { SupplierLite } from '@/types/b2b';
import type { BaseUnit, Product, UnitCode } from '@/types/pos';

/**
 * TASKS_BREAKDOWN-style back-office page (SYSTEM_ARCHITECTURE.md §2.1:
 * RSC-first/no-offline-requirement in spirit — this is a plain client
 * component doing ordinary fetches, no Dexie/outbox machinery like the POS
 * route needs). Part 4's integration requirement: `toBase()` from
 * lib/units.ts is reused completely unchanged, so a "1 BORI (Gatta) = 25kg"
 * conversion here lands in the exact same inventory_batches pool the
 * retail POS reads.
 *
 * The product catalogue is real (lib/b2b-client.ts's listPurchasableProducts,
 * scoped to the session's store) — only the supplier picker is still the
 * MOCK_SUPPLIERS stand-in described in lib/b2b-mock-data.ts's header comment
 * (out of this pass's scope; there is no real backend endpoint to list
 * suppliers by store yet, only create/read-one).
 */

const GST_RATE_OPTIONS = [0, 5, 12, 18, 28] as const;

/** Mirrors backend/src/api/unit-conversion/content-types/unit-conversion/lifecycles.ts's
 * VALID_UNITS_FOR_BASE exactly — a client-side mirror so the quick-add form only offers
 * combinations the backend will actually accept, not a substitute for that validation. */
const VALID_BULK_UNITS_FOR_BASE: Record<BaseUnit, UnitCode[]> = {
  G: ['KG', 'QUINTAL', 'PACKET', 'BORI', 'CARTON'],
  ML: ['L', 'PACKET', 'CRATE'],
  PCS: ['DOZEN', 'PACKET', 'CARTON'],
};

interface DraftLine {
  key: string;
  product: Product | null;
  unit: UnitCode | '';
  qty: string;
  ratePaise: string; // rupees, as typed
  gstRate: number;
  batchNo: string;
  expiryDate: string;
  discountPaise: string; // rupees, as typed
}

function emptyLine(): DraftLine {
  return { key: crypto.randomUUID(), product: null, unit: '', qty: '', ratePaise: '', gstRate: 0, batchNo: '', expiryDate: '', discountPaise: '0' };
}

// ---------------------------------------------------------------------------
// Searchable product combobox — the catalogue can run to hundreds of SKUs,
// so a plain <select> doesn't scale; this filters as you type.
// ---------------------------------------------------------------------------

function ProductCombobox({
  products,
  value,
  onSelect,
  onRequestNewProduct,
}: {
  products: Product[];
  value: Product | null;
  onSelect: (p: Product) => void;
  onRequestNewProduct: () => void;
}) {
  const { t } = useLanguage();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [panelPos, setPanelPos] = useState({ top: 0, left: 0, width: 0 });
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  // Rendered inside a table wrapped in overflow-x-auto — an absolutely
  // positioned panel there gets clipped by that ancestor's overflow (CSS sets
  // the other axis to auto too once one is non-visible), so the search
  // results were invisible. Portal it to <body> and position it manually
  // against the trigger's live bounding rect instead.
  useLayoutEffect(() => {
    if (!open || !triggerRef.current) return;
    const rect = triggerRef.current.getBoundingClientRect();
    setPanelPos({ top: rect.bottom + window.scrollY + 4, left: rect.left + window.scrollX, width: Math.max(rect.width, 256) });
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function onOutside(e: MouseEvent) {
      const target = e.target as Node;
      if (triggerRef.current?.contains(target) || panelRef.current?.contains(target)) return;
      setOpen(false);
    }
    function onScrollOrResize() {
      if (!triggerRef.current) return;
      const rect = triggerRef.current.getBoundingClientRect();
      setPanelPos({ top: rect.bottom + window.scrollY + 4, left: rect.left + window.scrollX, width: Math.max(rect.width, 256) });
    }
    document.addEventListener('mousedown', onOutside);
    window.addEventListener('scroll', onScrollOrResize, true);
    window.addEventListener('resize', onScrollOrResize);
    return () => {
      document.removeEventListener('mousedown', onOutside);
      window.removeEventListener('scroll', onScrollOrResize, true);
      window.removeEventListener('resize', onScrollOrResize);
    };
  }, [open]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return products;
    return products.filter((p) => p.name.toLowerCase().includes(q) || p.sku.toLowerCase().includes(q) || p.name_local?.toLowerCase().includes(q));
  }, [products, query]);

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={`flex min-h-[36px] w-44 items-center justify-between gap-1 rounded border px-2 py-1.5 text-left text-xs ${
          value ? 'border-slate-300 bg-white text-slate-800' : 'border-amber-300 bg-amber-50 text-amber-700'
        }`}
      >
        <span className="truncate">{value ? value.name : t('b2b.selectProduct')}</span>
        <ChevronDown size={12} className="shrink-0 text-slate-400" />
      </button>
      {open &&
        typeof document !== 'undefined' &&
        createPortal(
          <div
            ref={panelRef}
            style={{ position: 'absolute', top: panelPos.top, left: panelPos.left, width: panelPos.width }}
            className="z-50 rounded-lg border border-slate-200 bg-white shadow-xl"
          >
            <div className="flex items-center gap-1.5 border-b border-slate-100 p-2">
              <Search size={13} className="shrink-0 text-slate-400" />
              <input
                autoFocus
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={t('b2b.searchByNameSku')}
                className="w-full text-xs outline-none"
              />
            </div>
            <div className="max-h-56 overflow-y-auto py-1">
              {filtered.length === 0 && <p className="px-3 py-4 text-center text-xs text-slate-400">{t('b2b.noProductsFound')}</p>}
              {filtered.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => {
                    onSelect(p);
                    setOpen(false);
                    setQuery('');
                  }}
                  className="flex w-full flex-col items-start px-3 py-2 text-left text-xs hover:bg-primary/10"
                >
                  <span className="font-semibold text-slate-800">{p.name}</span>
                  <span className="text-[11px] text-slate-400">
                    {p.sku} · {t('b2b.gstShort')} {p.gst_rate}% · {t('orders.stock')} {p.stock_base}
                    {translateEnum(t, 'unit', p.base_unit).toLowerCase()}
                  </span>
                </button>
              ))}
            </div>
            <button
              type="button"
              onClick={() => {
                onRequestNewProduct();
                setOpen(false);
              }}
              className="flex min-h-[40px] w-full items-center gap-1.5 border-t border-slate-100 px-3 text-left text-xs font-bold text-primary hover:bg-primary/10"
            >
              <Plus size={12} strokeWidth={3} /> {t('b2b.newProductBtn')}
            </button>
          </div>,
          document.body
        )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Quick-add product modal — lets the merchant add a missing SKU without
// leaving the inwarding form.
// ---------------------------------------------------------------------------

function QuickAddProductModal({ onClose, onCreated }: { onClose: () => void; onCreated: (p: Product) => void }) {
  const { t } = useLanguage();
  const [name, setName] = useState('');
  const [sku, setSku] = useState('');
  const [baseUnit, setBaseUnit] = useState<BaseUnit>('PCS');
  const [bulkUnit, setBulkUnit] = useState<UnitCode | ''>('');
  const [bulkFactor, setBulkFactor] = useState('');
  const [gstRate, setGstRate] = useState<number>(5);
  const [sellRate, setSellRate] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const bulkOptions = VALID_BULK_UNITS_FOR_BASE[baseUnit];

  async function handleSubmit() {
    const sellRatePaise = Math.round(Number(sellRate) * 100);
    if (!name.trim() || !sku.trim() || !sellRatePaise) {
      setError(t('inventory.nameRequired'));
      return;
    }
    const purchaseUnit = bulkUnit || baseUnit;
    const factor = bulkUnit ? Number(bulkFactor) : undefined;
    if (bulkUnit && (!factor || factor <= 0)) {
      setError(t('b2b.enterBulkFactor').replace('{base}', translateEnum(t, 'unit', baseUnit).toLowerCase()).replace('{bulk}', translateEnum(t, 'unit', bulkUnit).toLowerCase()));
      return;
    }

    setSubmitting(true);
    setError(null);
    const res = await createPurchasableProduct({
      sku: sku.trim(),
      name: name.trim(),
      base_unit: baseUnit,
      default_sale_unit: baseUnit,
      default_purchase_unit: purchaseUnit,
      pricing_unit: baseUnit,
      sell_rate_paise: sellRatePaise,
      gst_rate: gstRate,
      purchase_unit_factor: factor,
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
          <h2 className="text-base font-bold text-slate-900">{t('b2b.newProductModalTitle')}</h2>
          <button onClick={onClose} className="flex h-9 w-9 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100">
            <X size={18} />
          </button>
        </div>

        <label className="mt-3 block text-xs font-semibold text-slate-600">{t('b2b.name')}</label>
        <input
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="mt-1 min-h-[44px] w-full rounded-lg border border-slate-200 px-3 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
        />

        <label className="mt-3 block text-xs font-semibold text-slate-600">{t('b2b.sku')}</label>
        <input
          value={sku}
          onChange={(e) => setSku(e.target.value)}
          className="mt-1 min-h-[44px] w-full rounded-lg border border-slate-200 px-3 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
        />

        <label className="mt-3 block text-xs font-semibold text-slate-600">{t('b2b.baseUnit')}</label>
        <div className="mt-1 grid grid-cols-3 gap-2">
          {(['PCS', 'G', 'ML'] as BaseUnit[]).map((u) => (
            <button
              key={u}
              type="button"
              onClick={() => {
                setBaseUnit(u);
                setBulkUnit('');
              }}
              className={`min-h-[40px] rounded-lg border text-xs font-semibold ${baseUnit === u ? 'border-primary bg-primary/10 text-primary' : 'border-slate-200 text-slate-600'}`}
            >
              {translateEnum(t, 'unit', u)}
            </button>
          ))}
        </div>

        <label className="mt-3 block text-xs font-semibold text-slate-600">{t('b2b.bulkPurchaseUnit')}</label>
        <div className="mt-1 flex gap-2">
          <select
            value={bulkUnit}
            onChange={(e) => setBulkUnit(e.target.value as UnitCode | '')}
            className="flex-1 rounded-lg border border-slate-200 px-2 py-2 text-sm"
          >
            <option value="">{t('b2b.sameAsBaseUnit')}</option>
            {bulkOptions.map((u) => (
              <option key={u} value={u}>
                {translateEnum(t, 'unit', u)}
              </option>
            ))}
          </select>
          {bulkUnit && (
            <input
              value={bulkFactor}
              onChange={(e) => setBulkFactor(e.target.value)}
              inputMode="decimal"
              placeholder={`${baseUnit.toLowerCase()}/${bulkUnit.toLowerCase()}`}
              className="w-28 rounded-lg border border-slate-200 px-2 py-2 text-sm"
            />
          )}
        </div>

        <label className="mt-3 block text-xs font-semibold text-slate-600">{t('b2b.gstRate')}</label>
        <div className="mt-1 grid grid-cols-5 gap-1.5">
          {GST_RATE_OPTIONS.map((r) => (
            <button
              key={r}
              type="button"
              onClick={() => setGstRate(r)}
              className={`min-h-[40px] rounded-lg border text-xs font-semibold ${gstRate === r ? 'border-primary bg-primary/10 text-primary' : 'border-slate-200 text-slate-600'}`}
            >
              {r}%
            </button>
          ))}
        </div>

        <label className="mt-3 block text-xs font-semibold text-slate-600">{t('b2b.sellingRatePerUnit').replace('{unit}', translateEnum(t, 'unit', baseUnit).toLowerCase())}</label>
        <input
          type="number"
          inputMode="decimal"
          value={sellRate}
          onChange={(e) => setSellRate(e.target.value)}
          className="mt-1 min-h-[44px] w-full rounded-lg border border-slate-200 px-3 text-sm font-semibold outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
        />

        {error && <p className="mt-2 text-xs font-medium text-rose-600">{translateError(t, error)}</p>}

        <div className="mt-5 flex gap-2">
          <button type="button" onClick={onClose} className="min-h-[44px] flex-1 rounded-lg border border-slate-200 text-sm font-semibold text-slate-600 hover:bg-slate-50">
            {t('common.cancel')}
          </button>
          <button
            type="button"
            disabled={submitting}
            onClick={handleSubmit}
            className="min-h-[44px] flex-1 rounded-lg bg-primary text-sm font-bold text-white shadow-sm shadow-primary/25 hover:bg-primary-hover disabled:opacity-50"
          >
            {submitting ? t('b2b.adding') : t('common.add') + ' ' + t('b2b.product')}
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

export default function PurchaseInwardPage() {
  const { t } = useLanguage();
  const [suppliers, setSuppliers] = useState<SupplierLite[]>([]);
  const [suppliersLoading, setSuppliersLoading] = useState(true);
  const [suppliersError, setSuppliersError] = useState<string | null>(null);
  const [supplierId, setSupplierId] = useState('');
  const [quickAddSupplierOpen, setQuickAddSupplierOpen] = useState(false);
  const [quickAddSupplierName, setQuickAddSupplierName] = useState('');
  const [quickAddSupplierSubmitting, setQuickAddSupplierSubmitting] = useState(false);

  const [products, setProducts] = useState<Product[]>([]);
  const [productsLoading, setProductsLoading] = useState(true);
  const [productsError, setProductsError] = useState<string | null>(null);
  const [newProductModalOpen, setNewProductModalOpen] = useState(false);
  const [newProductForLineKey, setNewProductForLineKey] = useState<string | null>(null);

  const [supplierInvoiceNo, setSupplierInvoiceNo] = useState('');
  const [supplierInvoiceDate, setSupplierInvoiceDate] = useState('');
  const [paymentTermsDays, setPaymentTermsDays] = useState('0');
  const [lines, setLines] = useState<DraftLine[]>([]);
  const [freightRupees, setFreightRupees] = useState('0');
  const [supplyType, setSupplyType] = useState<'INTRA_STATE' | 'INTER_STATE'>('INTRA_STATE');

  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<{ grnNo: string; totalPaise: number } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setProductsLoading(true);
    void listPurchasableProducts().then((res) => {
      if (cancelled) return;
      setProductsLoading(false);
      if (!res.ok) return setProductsError(res.error);
      setProducts(res.data);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    setSuppliersLoading(true);
    void listSuppliers().then((res) => {
      if (cancelled) return;
      setSuppliersLoading(false);
      if (!res.ok) return setSuppliersError(res.error);
      setSuppliers(res.data);
      setSupplierId((current) => current || res.data[0]?.id || '');
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const supplier = suppliers.find((s) => s.id === supplierId);

  const computedLines = useMemo(
    () =>
      lines.map((line) => {
        if (!line.product || !line.unit || !line.qty) {
          return { line, qtyBase: new Decimal(0), ratePaise: 0, discountPaise: 0, subtotal: 0, taxPaise: 0, lineTotal: 0, error: null as string | null };
        }
        try {
          findConversion(line.product.unit_conversions, line.unit);
          const qtyBase = toBase(line.qty, line.unit, line.product.unit_conversions);
          const ratePaise = Math.round(Number(line.ratePaise || '0') * 100);
          const discountPaise = Math.round(Number(line.discountPaise || '0') * 100);
          const gross = new Decimal(ratePaise).mul(line.qty);
          const subtotal = Math.max(0, roundPaise(gross) - discountPaise);
          const taxPaise = roundPaise(new Decimal(subtotal).mul(line.gstRate).div(100));
          return { line, qtyBase, ratePaise, discountPaise, subtotal, taxPaise, lineTotal: subtotal + taxPaise, error: null as string | null };
        } catch (err) {
          return { line, qtyBase: new Decimal(0), ratePaise: 0, discountPaise: 0, subtotal: 0, taxPaise: 0, lineTotal: 0, error: (err as { code?: string })?.code ?? 'ERR_QTY_INVALID' };
        }
      }),
    [lines]
  );

  const subtotalPaise = computedLines.reduce((s, l) => s + l.subtotal, 0);
  const taxPaise = computedLines.reduce((s, l) => s + l.taxPaise, 0);
  const cgstPaise = supplyType === 'INTRA_STATE' ? Math.round(taxPaise / 2) : 0;
  const sgstPaise = supplyType === 'INTRA_STATE' ? taxPaise - cgstPaise : 0;
  const igstPaise = supplyType === 'INTER_STATE' ? taxPaise : 0;
  const freightPaise = Math.round(Number(freightRupees || '0') * 100);
  const totalPaise = subtotalPaise + taxPaise + freightPaise;

  function updateLine(key: string, patch: Partial<DraftLine>) {
    setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  }

  function selectProductForLine(key: string, product: Product) {
    updateLine(key, {
      product,
      unit: product.default_purchase_unit,
      ratePaise: (product.sell_rate_paise / 100).toFixed(2),
      gstRate: product.gst_rate,
    });
  }

  function addLine() {
    setLines((ls) => [...ls, emptyLine()]);
  }

  function removeLine(key: string) {
    setLines((ls) => ls.filter((l) => l.key !== key));
  }

  async function handleQuickAddSupplier() {
    if (!quickAddSupplierName.trim()) return;
    setQuickAddSupplierSubmitting(true);
    setError(null);
    const res = await createSupplier({ name: quickAddSupplierName.trim() });
    setQuickAddSupplierSubmitting(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    setSuppliers((s) => [...s, res.data]);
    setSupplierId(res.data.id);
    setQuickAddSupplierName('');
    setQuickAddSupplierOpen(false);
  }

  function handleProductCreated(product: Product) {
    setProducts((ps) => [product, ...ps]);
    if (newProductForLineKey) {
      selectProductForLine(newProductForLineKey, product);
    }
    setNewProductModalOpen(false);
    setNewProductForLineKey(null);
  }

  async function handleSubmit() {
    setError(null);
    if (!supplier) return setError(t('b2b.errSelectSupplier'));
    if (lines.length === 0) return setError(t('b2b.errAddItem'));
    if (lines.some((l) => !l.product)) return setError(t('b2b.errSelectProduct'));
    if (lines.some((l) => !l.unit)) return setError(t('b2b.errSelectUnit'));
    if (lines.some((l) => !l.qty || Number(l.qty) <= 0)) return setError(t('b2b.errEnterQty'));
    if (computedLines.some((l) => l.error)) return setError(t('b2b.errFixLines'));

    setSubmitting(true);
    const termsDays = Number(paymentTermsDays) || 0;
    const dueDate = termsDays > 0 ? new Date(Date.now() + termsDays * 86400000).toISOString().slice(0, 10) : undefined;
    const res = await submitPurchaseInward({
      client_uuid: crypto.randomUUID(),
      supplier_id: supplier.id,
      supplier_invoice_no: supplierInvoiceNo || undefined,
      supplier_invoice_date: supplierInvoiceDate || undefined,
      due_date: dueDate,
      items: computedLines.map((l) => ({
        product_id: l.line.product!.id,
        received_qty: l.line.qty,
        received_unit: l.line.unit as UnitCode,
        batch_no: l.line.batchNo || undefined,
        expiry_date: l.line.expiryDate || undefined,
        cost_rate_paise: l.ratePaise,
        discount_paise: l.discountPaise || undefined,
        gst_rate: l.line.gstRate,
      })),
      freight_paise: freightPaise || undefined,
    });
    setSubmitting(false);

    if (!res.ok) return setError(res.error);
    setResult({ grnNo: res.data.purchase_bill.grn_no, totalPaise: res.data.purchase_bill.total_paise });
  }

  return (
    <div className="w-full max-w-none px-4 py-6 sm:px-6 lg:px-8">
      <div className="flex items-center gap-3">
        <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-gradient-to-br from-primary to-accent text-white shadow-sm">
          <PackagePlus size={20} />
        </span>
        <div>
          <h1 className="text-lg font-bold text-slate-900">{t('b2b.purchaseTitle')}</h1>
          <p className="text-sm text-slate-500">{t('b2b.purchaseSubtitle')}</p>
        </div>
      </div>

      {result ? (
        <div className="mt-6 rounded-2xl border border-emerald-200 bg-emerald-50 p-5">
          <div className="flex items-center gap-2 text-emerald-800">
            <CheckCircle2 size={18} />
            <p className="font-bold">{t('b2b.inwardPosted')} {result.grnNo}</p>
          </div>
          <p className="mt-1 text-2xl font-black text-emerald-700">{formatPaise(result.totalPaise)}</p>
          <button
            type="button"
            onClick={() => {
              setResult(null);
              setLines([]);
              setSupplierInvoiceNo('');
              setSupplierInvoiceDate('');
              setPaymentTermsDays('0');
            }}
            className="mt-3 rounded-xl bg-gradient-to-r from-emerald-500 to-emerald-600 px-4 py-2.5 text-sm font-bold text-white shadow-md shadow-emerald-500/25 transition active:scale-[0.98]"
          >
            {t('b2b.newInward')}
          </button>
        </div>
      ) : (
        <>
          <div className="mt-4 grid grid-cols-2 gap-4 rounded-2xl border border-slate-200/80 bg-white p-4 shadow-sm sm:grid-cols-4">
            <label className="text-sm text-slate-600">
              {t('b2b.supplier')}
              <div className="mt-1 flex gap-2">
                <select
                  value={supplierId}
                  disabled={suppliersLoading}
                  onChange={(e) => setSupplierId(e.target.value)}
                  className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm disabled:bg-slate-50 disabled:text-slate-400"
                >
                  {suppliersLoading && <option value="">{t('b2b.loadingSuppliers')}</option>}
                  {!suppliersLoading && suppliers.length === 0 && <option value="">{t('b2b.noSuppliersYetAdd')}</option>}
                  {suppliers.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
                <button type="button" onClick={() => setQuickAddSupplierOpen(true)} className="shrink-0 rounded border border-slate-300 px-2 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50">
                  {t('b2b.newSupplierBtn')}
                </button>
              </div>
              {suppliersError && <p className="mt-1 text-xs text-rose-600">{t('b2b.couldNotLoadSuppliers')} ({translateError(t, suppliersError)}).</p>}
              {supplier && <p className="mt-1 text-xs text-slate-500">{t('b2b.currentPayable')}: {formatPaise(supplier.current_balance_paise)}</p>}
            </label>
            <label className="text-sm text-slate-600">
              {t('b2b.supplierInvoiceNo')}
              <input value={supplierInvoiceNo} onChange={(e) => setSupplierInvoiceNo(e.target.value)} className="mt-1 w-full rounded border border-slate-300 px-2 py-1.5 text-sm" />
            </label>
            <label className="text-sm text-slate-600">
              {t('b2b.supplierInvoiceDate')}
              <input type="date" value={supplierInvoiceDate} onChange={(e) => setSupplierInvoiceDate(e.target.value)} className="mt-1 w-full rounded border border-slate-300 px-2 py-1.5 text-sm" />
            </label>
            <label className="text-sm text-slate-600">
              {t('b2b.paymentTermsDays')}
              <input
                type="number"
                inputMode="numeric"
                value={paymentTermsDays}
                onChange={(e) => setPaymentTermsDays(e.target.value)}
                placeholder={t('b2b.dueOnReceipt')}
                className="mt-1 w-full rounded border border-slate-300 px-2 py-1.5 text-sm"
              />
            </label>
          </div>

          {quickAddSupplierOpen && (
            <div className="mt-2 flex items-center gap-2 rounded-lg border border-slate-300 bg-slate-50 p-3">
              <input
                autoFocus
                value={quickAddSupplierName}
                onChange={(e) => setQuickAddSupplierName(e.target.value)}
                placeholder={t('b2b.newSupplierPlaceholder')}
                className="flex-1 rounded border border-slate-300 px-2 py-1.5 text-sm"
              />
              <button
                type="button"
                onClick={handleQuickAddSupplier}
                disabled={quickAddSupplierSubmitting}
                className="rounded bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-500 disabled:opacity-50"
              >
                {quickAddSupplierSubmitting ? t('b2b.adding') : t('common.add')}
              </button>
              <button type="button" onClick={() => setQuickAddSupplierOpen(false)} className="text-xs text-slate-500">
                {t('common.cancel')}
              </button>
            </div>
          )}

          {productsError && <p className="mt-3 rounded-xl bg-rose-50 px-4 py-2.5 text-sm text-rose-700">{t('b2b.couldNotLoadCatalogue')} ({translateError(t, productsError)}).</p>}

          {lines.length === 0 ? (
            <div className="mt-4 flex flex-col items-center gap-3 rounded-2xl border border-dashed border-slate-300 bg-white py-14 shadow-sm">
              <PackagePlus size={28} className="text-slate-300" />
              <p className="text-sm text-slate-500">{t('b2b.noItemsAdded')}</p>
              <button
                type="button"
                onClick={addLine}
                disabled={productsLoading}
                className="flex min-h-[48px] items-center gap-1.5 rounded-xl bg-primary px-5 text-sm font-bold text-white shadow-md shadow-primary/25 transition hover:bg-primary-hover disabled:opacity-50"
              >
                <Plus size={16} strokeWidth={3} />
                {productsLoading ? t('b2b.loadingCatalogue') : t('b2b.addFirstItem')}
              </button>
            </div>
          ) : (
            <div className="mt-4 overflow-x-auto rounded-2xl border border-slate-200/80 bg-white shadow-sm">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-slate-50/95 text-left text-xs font-bold uppercase tracking-wide text-slate-500 backdrop-blur">
                  <tr>
                    <th className="px-3 py-2.5">{t('b2b.product')}</th>
                    <th className="px-3 py-2.5">{t('b2b.unit')}</th>
                    <th className="px-3 py-2.5">{t('b2b.qty')}</th>
                    <th className="px-3 py-2.5">{t('b2b.rate')}</th>
                    <th className="px-3 py-2.5">{t('b2b.gstPercent')}</th>
                    <th className="px-3 py-2.5">{t('b2b.batchNo')}</th>
                    <th className="px-3 py-2.5">{t('b2b.expiry')}</th>
                    <th className="px-3 py-2.5 text-right">{t('b2b.stockPreview')}</th>
                    <th className="px-3 py-2.5 text-right">{t('b2b.lineTotal')}</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {computedLines.map(({ line, qtyBase, lineTotal, error: lineError }) => {
                    const purchaseUnits = line.product?.unit_conversions.filter((c) => c.is_purchase_unit) ?? [];
                    const projectedStock = line.product ? new Decimal(line.product.stock_base).plus(qtyBase) : new Decimal(0);
                    return (
                      <tr key={line.key} className="border-t border-slate-100 align-top">
                        <td className="px-3 py-2">
                          <ProductCombobox
                            products={products}
                            value={line.product}
                            onSelect={(p) => selectProductForLine(line.key, p)}
                            onRequestNewProduct={() => {
                              setNewProductForLineKey(line.key);
                              setNewProductModalOpen(true);
                            }}
                          />
                        </td>
                        <td className="px-3 py-2">
                          <select
                            value={line.unit}
                            disabled={!line.product}
                            onChange={(e) => updateLine(line.key, { unit: e.target.value as UnitCode })}
                            className="rounded border border-slate-300 px-1.5 py-1 text-xs disabled:bg-slate-50 disabled:text-slate-400"
                          >
                            {!line.product && <option value="">—</option>}
                            {purchaseUnits.map((u) => (
                              <option key={u.unit_code} value={u.unit_code}>
                                {translateEnum(t, 'unit', u.unit_code)}
                              </option>
                            ))}
                          </select>
                        </td>
                        <td className="px-3 py-2">
                          <input
                            value={line.qty}
                            onChange={(e) => updateLine(line.key, { qty: e.target.value })}
                            disabled={!line.product}
                            inputMode="decimal"
                            placeholder="0"
                            className="w-16 rounded border border-slate-300 px-1.5 py-1 text-xs disabled:bg-slate-50"
                          />
                        </td>
                        <td className="px-3 py-2">
                          <input
                            value={line.ratePaise}
                            onChange={(e) => updateLine(line.key, { ratePaise: e.target.value })}
                            disabled={!line.product}
                            inputMode="decimal"
                            placeholder="0.00"
                            className="w-20 rounded border border-slate-300 px-1.5 py-1 text-xs disabled:bg-slate-50"
                          />
                        </td>
                        <td className="px-3 py-2">
                          <select
                            value={line.gstRate}
                            disabled={!line.product}
                            onChange={(e) => updateLine(line.key, { gstRate: Number(e.target.value) })}
                            className="rounded border border-slate-300 px-1.5 py-1 text-xs disabled:bg-slate-50 disabled:text-slate-400"
                          >
                            {GST_RATE_OPTIONS.map((r) => (
                              <option key={r} value={r}>
                                {r}%
                              </option>
                            ))}
                          </select>
                        </td>
                        <td className="px-3 py-2">
                          <input value={line.batchNo} onChange={(e) => updateLine(line.key, { batchNo: e.target.value })} disabled={!line.product} className="w-20 rounded border border-slate-300 px-1.5 py-1 text-xs disabled:bg-slate-50" />
                        </td>
                        <td className="px-3 py-2">
                          <input type="date" value={line.expiryDate} onChange={(e) => updateLine(line.key, { expiryDate: e.target.value })} disabled={!line.product} className="rounded border border-slate-300 px-1.5 py-1 text-xs disabled:bg-slate-50" />
                        </td>
                        <td className="px-3 py-2 text-right text-xs text-slate-500">
                          {lineError ? <span className="text-rose-600">{translateError(t, lineError)}</span> : line.product ? `${line.product.stock_base} → ${projectedStock.toFixed(0)}` : '0'}
                        </td>
                        <td className="px-3 py-2 text-right font-medium text-slate-900">{formatPaise(lineTotal)}</td>
                        <td className="px-3 py-2 text-right">
                          <button
                            type="button"
                            onClick={() => removeLine(line.key)}
                            className="flex h-7 w-7 items-center justify-center rounded-lg text-slate-400 transition hover:bg-rose-50 hover:text-rose-600"
                          >
                            <Trash2 size={14} />
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              <button
                type="button"
                onClick={addLine}
                className="flex w-full items-center justify-center gap-1.5 border-t border-slate-200 py-2.5 text-xs font-bold text-primary transition hover:bg-primary/10"
              >
                <Plus size={13} strokeWidth={3} />
                {t('b2b.addLine')}
              </button>
            </div>
          )}

          {lines.length > 0 && (
            <div className="mt-4 flex flex-col items-start justify-between gap-4 sm:flex-row">
              <div className="flex flex-wrap items-start gap-4">
                <label className="text-sm text-slate-600">
                  {t('b2b.freight')}
                  <input value={freightRupees} onChange={(e) => setFreightRupees(e.target.value)} inputMode="decimal" className="mt-1 block w-32 rounded border border-slate-300 px-2 py-1.5 text-sm" />
                </label>
                <div className="text-sm text-slate-600">
                  {t('b2b.supplyType')}
                  <div className="mt-1 flex gap-2">
                    <button
                      type="button"
                      onClick={() => setSupplyType('INTRA_STATE')}
                      className={`min-h-[36px] rounded border px-3 text-xs font-semibold ${supplyType === 'INTRA_STATE' ? 'border-primary bg-primary/10 text-primary' : 'border-slate-300 text-slate-600'}`}
                    >
                      {t('b2b.intraState')}
                    </button>
                    <button
                      type="button"
                      onClick={() => setSupplyType('INTER_STATE')}
                      className={`min-h-[36px] rounded border px-3 text-xs font-semibold ${supplyType === 'INTER_STATE' ? 'border-primary bg-primary/10 text-primary' : 'border-slate-300 text-slate-600'}`}
                    >
                      {t('b2b.interState')}
                    </button>
                  </div>
                </div>
              </div>
              <div className="w-full space-y-1.5 rounded-2xl border border-slate-200/80 bg-white p-4 text-sm shadow-sm sm:w-72">
                <div className="flex justify-between text-slate-500">
                  <span>{t('b2b.subtotalTaxable')}</span>
                  <span className="font-medium text-slate-700">{formatPaise(subtotalPaise)}</span>
                </div>
                {supplyType === 'INTRA_STATE' ? (
                  <>
                    <div className="flex justify-between text-slate-500">
                      <span>{t('b2b.cgst')}</span>
                      <span className="font-medium text-slate-700">{formatPaise(cgstPaise)}</span>
                    </div>
                    <div className="flex justify-between text-slate-500">
                      <span>{t('b2b.sgst')}</span>
                      <span className="font-medium text-slate-700">{formatPaise(sgstPaise)}</span>
                    </div>
                  </>
                ) : (
                  <div className="flex justify-between text-slate-500">
                    <span>{t('b2b.igst')}</span>
                    <span className="font-medium text-slate-700">{formatPaise(igstPaise)}</span>
                  </div>
                )}
                <div className="flex justify-between text-slate-500">
                  <span>{t('b2b.freight')}</span>
                  <span className="font-medium text-slate-700">{formatPaise(freightPaise)}</span>
                </div>
                <div className="flex justify-between border-t border-slate-200 pt-2 text-base">
                  <span className="font-bold text-slate-700">{t('b2b.totalPayable')}</span>
                  <span className="font-black text-primary">{formatPaise(totalPaise)}</span>
                </div>
              </div>
            </div>
          )}

          {error && <p className="mt-3 rounded-xl bg-rose-50 px-4 py-2.5 text-sm text-rose-700">{translateError(t, error)}</p>}

          {lines.length > 0 && (
            <button
              type="button"
              onClick={handleSubmit}
              disabled={submitting}
              className="mt-4 w-full rounded-xl bg-gradient-to-r from-primary to-accent py-3.5 text-sm font-bold text-white shadow-lg shadow-primary/25 transition hover:shadow-primary/40 active:scale-[0.98] disabled:cursor-not-allowed disabled:from-slate-300 disabled:to-slate-300 disabled:shadow-none"
            >
              {submitting ? t('b2b.posting') : `${t('b2b.postInward')} · ${formatPaise(totalPaise)}`}
            </button>
          )}
        </>
      )}

      {newProductModalOpen && (
        <QuickAddProductModal
          onClose={() => {
            setNewProductModalOpen(false);
            setNewProductForLineKey(null);
          }}
          onCreated={handleProductCreated}
        />
      )}
    </div>
  );
}
