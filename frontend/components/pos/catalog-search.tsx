'use client';

import { useMemo } from 'react';
import { Plus } from 'lucide-react';
import type { Product } from '@/types/pos';
import { stockStatus } from '@/lib/mock-data';
import { formatPaise } from '@/lib/money';
import { useLanguage } from '@/context/LanguageContext';
import { translateEnum } from '@/lib/translations';

interface CatalogSearchProps {
  products: Product[];
  categories: string[];
  query: string;
  category: string | null;
  onCategoryChange: (category: string | null) => void;
  onAdd: (product: Product) => void;
  /** Milestone 4: store.config.track_inventory === false (SALOON/DHABA) hides the stock column/filter entirely. */
  showStock?: boolean;
}

const STATUS_STYLES: Record<ReturnType<typeof stockStatus>, string> = {
  IN_STOCK: 'bg-emerald-100 text-emerald-600',
  LOW: 'bg-amber-100 text-amber-600',
  OUT: 'bg-rose-100 text-rose-600',
};

export function CatalogSearch({ products, categories, query, category, onCategoryChange, onAdd, showStock = true }: CatalogSearchProps) {
  const { t } = useLanguage();
  const STATUS_LABEL: Record<ReturnType<typeof stockStatus>, string> = {
    IN_STOCK: t('pos.inStock'),
    LOW: t('pos.lowStock'),
    OUT: t('pos.outOfStock'),
  };
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return products.filter((p) => {
      if (category && p.category !== category) return false;
      if (!q) return true;
      return (
        p.name.toLowerCase().includes(q) ||
        (p.name_local ?? '').includes(query.trim()) ||
        p.sku.toLowerCase().includes(q) ||
        (p.barcode ?? '').includes(q)
      );
    });
  }, [products, query, category]);

  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-wrap gap-1.5 border-b border-slate-200 p-2">
        <button
          type="button"
          onClick={() => onCategoryChange(null)}
          className={`rounded-full px-3 py-1.5 text-xs font-semibold transition ${
            category === null ? 'bg-gradient-to-r from-primary to-accent text-white shadow-sm' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
          }`}
        >
          {t('pos.all')}
        </button>
        {categories.map((c) => (
          <button
            key={c}
            type="button"
            onClick={() => onCategoryChange(c)}
            className={`rounded-full px-3 py-1.5 text-xs font-semibold transition ${
              category === c ? 'bg-gradient-to-r from-primary to-accent text-white shadow-sm' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
            }`}
          >
            {c}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-3 py-2 font-medium">{t('pos.item')}</th>
              <th className="px-3 py-2 font-medium">{t('pos.category')}</th>
              <th className="px-3 py-2 font-medium">{t('pos.price')}</th>
              {showStock && <th className="px-3 py-2 font-medium">{t('orders.stock')}</th>}
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody>
            {filtered.map((product) => {
              const status = stockStatus(product);
              const outOfStock = showStock && status === 'OUT';
              return (
                <tr key={product.id} className="border-t border-slate-200/60 hover:bg-slate-100/70">
                  <td className="px-3 py-2">
                    <p className="font-medium text-slate-900">{product.name}</p>
                    <p className="text-xs text-slate-500">
                      {product.sku}
                      {product.barcode ? ` · ${product.barcode}` : ''}
                    </p>
                  </td>
                  <td className="px-3 py-2 text-slate-500">{product.category}</td>
                  <td className="px-3 py-2 text-slate-700">
                    {formatPaise(product.sell_rate_paise)}
                    <span className="text-slate-500"> /{translateEnum(t, 'unit', product.pricing_unit).toLowerCase()}</span>
                  </td>
                  {showStock && (
                    <td className="px-3 py-2">
                      <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${STATUS_STYLES[status]}`}>
                        {STATUS_LABEL[status]}
                      </span>
                    </td>
                  )}
                  <td className="px-3 py-2 text-right">
                    <button
                      type="button"
                      disabled={outOfStock}
                      onClick={() => onAdd(product)}
                      className="inline-flex items-center gap-1 rounded-lg bg-emerald-600 px-3 py-2 text-xs font-bold text-white transition hover:bg-emerald-500 active:scale-95 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-500"
                    >
                      <Plus size={13} strokeWidth={3} />
                      {t('pos.add')}
                    </button>
                  </td>
                </tr>
              );
            })}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={showStock ? 5 : 4} className="px-3 py-8 text-center text-slate-500">
                  {t('pos.noItemsMatch')}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
