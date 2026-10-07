'use client';

import { useEffect, useState } from 'react';
import { Building2 } from 'lucide-react';
import { formatPaise } from '@/lib/money';
import { listSuppliers } from '@/lib/b2b-client';
import { useLanguage } from '@/context/LanguageContext';
import { translateError } from '@/lib/translations';
import type { SupplierLite } from '@/types/b2b';

/** Picker in front of the real per-supplier ledger at /b2b/suppliers/[id]/ledger. */
export default function SuppliersPage() {
  const { t } = useLanguage();
  const [suppliers, setSuppliers] = useState<SupplierLite[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void listSuppliers().then((res) => {
      if (cancelled) return;
      setLoading(false);
      if (!res.ok) return setError(res.error);
      setSuppliers(res.data);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="w-full max-w-none px-4 py-6 sm:px-6 lg:px-8">
      <h1 className="text-lg font-semibold text-slate-900">{t('suppliers.title')}</h1>
      <p className="mt-1 text-sm text-slate-500">{t('suppliers.subtitle')}</p>

      {error && <p className="mt-4 text-sm text-rose-600">{t('suppliers.couldNotLoadLedger')} ({translateError(t, error)}).</p>}
      {loading && <p className="mt-4 text-sm text-slate-500">{t('common.loading')}</p>}

      {!loading && !error && (
        <div className="mt-4 overflow-hidden rounded-lg border border-slate-200 bg-white">
          {suppliers.length === 0 && (
            <div className="flex flex-col items-center gap-2 px-4 py-10 text-center text-slate-400">
              <Building2 size={28} />
              <p className="text-sm">{t('suppliers.noSuppliersYet')}</p>
            </div>
          )}
          {suppliers.map((s, i) => (
            <a
              key={s.id}
              href={`/b2b/suppliers/${s.id}/ledger`}
              className={`flex min-h-[56px] items-center justify-between px-4 py-3 hover:bg-slate-50 ${i > 0 ? 'border-t border-slate-100' : ''}`}
            >
              <div>
                <p className="text-sm font-semibold text-slate-900">{s.name}</p>
                <p className="text-xs text-slate-500">
                  {t('suppliers.gstin')} {s.gstin ?? '—'} · {t('suppliers.phoneEnding')} {s.phone_last4 ?? '—'}
                </p>
              </div>
              <p className={`text-sm font-semibold ${s.current_balance_paise > 0 ? 'text-rose-600' : 'text-emerald-600'}`}>
                {formatPaise(Math.abs(s.current_balance_paise))}
              </p>
            </a>
          ))}
        </div>
      )}
    </div>
  );
}
