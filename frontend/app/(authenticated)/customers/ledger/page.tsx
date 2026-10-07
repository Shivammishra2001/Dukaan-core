'use client';

import { useEffect, useMemo, useState } from 'react';
import { Search, Users } from 'lucide-react';
import { listCustomers } from '@/lib/customer-client';
import { formatPaise } from '@/lib/money';
import { useLanguage } from '@/context/LanguageContext';
import { translateError } from '@/lib/translations';
import type { CustomerLite } from '@/types/customer';

/** Customer directory (Grahak Khata) — every customer's live current_balance_paise, drilling into /customers/[id]/ledger for the statement. */
export default function CustomerKhataPage() {
  const { t } = useLanguage();
  const [customers, setCustomers] = useState<CustomerLite[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void listCustomers().then((res) => {
      if (cancelled) return;
      setLoading(false);
      if (!res.ok) return setError(res.error);
      setCustomers(res.data);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return customers;
    return customers.filter((c) => c.name.toLowerCase().includes(q) || c.name_local?.toLowerCase().includes(q) || c.phone_last4?.includes(q));
  }, [customers, query]);

  const totalOutstanding = useMemo(() => customers.reduce((sum, c) => sum + Math.max(c.current_balance_paise, 0), 0), [customers]);

  return (
    <div className="w-full max-w-none px-4 py-4 sm:px-6 sm:py-6 lg:px-8">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-lg font-bold text-slate-900">{t('khata.title')}</h1>
          <p className="mt-1 text-sm text-slate-500">{t('khata.subtitle')}</p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-right shadow-sm">
          <p className="text-[11px] font-semibold text-slate-500">{t('khata.totalOutstanding')}</p>
          <p className="text-lg font-black text-rose-600">{formatPaise(totalOutstanding)}</p>
        </div>
      </div>

      <div className="relative mt-4">
        <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t('khata.searchByNamePhone')}
          className="min-h-[48px] w-full rounded-lg border border-slate-200 bg-white py-2.5 pl-9 pr-3 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
        />
      </div>

      {error && <p className="mt-4 text-sm text-rose-600">{t('khata.couldNotLoadCustomers')} ({translateError(t, error)}).</p>}
      {loading && <p className="mt-4 text-sm text-slate-500">{t('common.loading')}</p>}

      {!loading && !error && (
        <div className="mt-4 overflow-hidden rounded-xl border border-slate-200 bg-white">
          {filtered.length === 0 && (
            <div className="flex flex-col items-center gap-2 px-4 py-10 text-center text-slate-400">
              <Users size={28} />
              <p className="text-sm">{t('khata.noCustomersFound')}</p>
            </div>
          )}
          {filtered.map((c, i) => (
            <a
              key={c.id}
              href={`/customers/${c.id}/ledger`}
              className={`flex min-h-[56px] items-center justify-between gap-3 px-4 py-3 hover:bg-slate-50 ${i > 0 ? 'border-t border-slate-100' : ''}`}
            >
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-slate-900">
                  {c.name}
                  {c.name_local ? <span className="ml-1.5 text-slate-400">({c.name_local})</span> : null}
                </p>
                <p className="text-xs text-slate-500">
                  {c.phone_last4 ? `${t('khata.phoneEnding')} ${c.phone_last4}` : t('khata.noPhoneOnFile')}
                  {c.credit_limit_enabled ? ` · ${t('orders.limit')} ${formatPaise(c.credit_limit_paise)}` : ''}
                </p>
              </div>
              <p className={`shrink-0 text-sm font-bold ${c.current_balance_paise > 0 ? 'text-rose-600' : c.current_balance_paise < 0 ? 'text-emerald-600' : 'text-slate-400'}`}>
                {formatPaise(Math.abs(c.current_balance_paise))}
                {c.current_balance_paise < 0 ? <span className="ml-1 text-[10px] font-semibold uppercase text-emerald-600">{t('khata.advance')}</span> : null}
              </p>
            </a>
          ))}
        </div>
      )}
    </div>
  );
}
