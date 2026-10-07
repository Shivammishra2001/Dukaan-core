'use client';

import type { Product } from '@/types/pos';
import { quickGridChips } from '@/lib/units';
import { formatPaise } from '@/lib/money';
import { useLanguage } from '@/context/LanguageContext';
import { translateEnum } from '@/lib/translations';

interface QuickGridProps {
  products: Product[];
  onAdd: (product: Product, enteredQty: string, unit: Product['default_sale_unit']) => void;
}

/**
 * REQUIREMENTS.md example items (Chini, Daal, Tel, Masala) — non-barcode
 * loose goods. One tap on a chip adds that exact quantity; there is no
 * intermediate "select product then enter qty" step, matching the Village
 * Kirana workflow's speed requirement.
 */
export function QuickGrid({ products, onAdd }: QuickGridProps) {
  const { t } = useLanguage();
  if (products.length === 0) {
    return <p className="p-6 text-sm text-slate-500">{t('pos.noLooseItems')}</p>;
  }

  return (
    <div className="grid grid-cols-2 gap-3 p-3 sm:grid-cols-3 lg:grid-cols-4">
      {products.map((product) => (
        <div
          key={product.id}
          className="flex flex-col justify-between rounded-xl border border-slate-200/80 bg-white p-3.5 shadow-sm transition hover:border-emerald-200 hover:shadow-md"
        >
          <div>
            <p className="font-semibold leading-tight text-slate-900">{product.name}</p>
            {product.name_local && <p className="text-sm leading-tight text-slate-500">{product.name_local}</p>}
            <p className="mt-1.5 text-xs font-medium text-slate-500">
              {formatPaise(product.sell_rate_paise)} <span className="text-slate-400">/ {translateEnum(t, 'unit', product.pricing_unit).toLowerCase()}</span>
            </p>
          </div>
          <div className="mt-3 grid grid-cols-4 gap-1.5">
            {quickGridChips(product.base_unit).map((chip) => (
              <button
                key={chip.label}
                type="button"
                onClick={() => onAdd(product, chip.enteredQty, chip.unit)}
                className="min-h-[44px] rounded-lg bg-emerald-50 py-2 text-xs font-bold text-emerald-700 transition hover:bg-emerald-600 hover:text-white active:scale-95"
              >
                {chip.label}
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
