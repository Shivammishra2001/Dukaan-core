'use client';

import { useMemo, useState } from 'react';
import { UserPlus, X } from 'lucide-react';
import type { CustomerLite } from '@/types/pos';
import { creditHeadroomPaise } from '@/lib/credit';
import { formatPaise } from '@/lib/money';
import { useLanguage } from '@/context/LanguageContext';

interface CustomerBarProps {
  customer: CustomerLite | null;
  directory: CustomerLite[];
  onBind: (customer: CustomerLite) => void;
  onClear: () => void;
}

/** "Quick customer attachment" (search by phone last4 / name, quick bind) + credit chip. */
export function CustomerBar({ customer, directory, onBind, onClear }: CustomerBarProps) {
  const { t } = useLanguage();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return directory.slice(0, 6);
    return directory.filter((c) => c.name.toLowerCase().includes(q) || (c.phone_last4 ?? '').includes(q)).slice(0, 6);
  }, [directory, query]);

  if (!customer) {
    return (
      <div className="relative border-b border-slate-200 p-2">
        <button
          id="attach-customer-trigger"
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="flex min-h-[44px] w-full items-center justify-center gap-1.5 rounded-lg border border-dashed border-slate-300 text-xs font-semibold text-slate-500 transition hover:border-primary hover:text-primary"
        >
          <UserPlus size={14} />
          {t('pos.attachCustomer')} <kbd className="text-[10px] text-slate-400">F9</kbd>
        </button>
        {open && (
          <div className="absolute left-2 right-2 top-full z-20 mt-1 rounded-md border border-slate-300 bg-white p-2 shadow-xl">
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t('pos.searchNameOrLast4')}
              className="w-full rounded border border-slate-300 bg-slate-100 px-2 py-1.5 text-xs text-slate-900 focus:outline-none"
            />
            <ul className="mt-1 max-h-48 overflow-y-auto">
              {results.map((c) => (
                <li key={c.id}>
                  <button
                    type="button"
                    onClick={() => {
                      onBind(c);
                      setOpen(false);
                      setQuery('');
                    }}
                    className="flex w-full items-center justify-between rounded px-2 py-1.5 text-left text-xs text-slate-800 hover:bg-slate-100"
                  >
                    <span>{c.name}</span>
                    <span className="text-slate-500">{c.phone_last4 ? `•• ${c.phone_last4}` : ''}</span>
                  </button>
                </li>
              ))}
              {results.length === 0 && <li className="px-2 py-2 text-xs text-slate-500">{t('pos.noMatch')}</li>}
            </ul>
          </div>
        )}
      </div>
    );
  }

  const headroom = creditHeadroomPaise(customer);
  const chipTone =
    headroom === null
      ? 'bg-slate-100 text-slate-500'
      : headroom <= 0
        ? 'bg-rose-100 text-rose-600'
        : headroom < customer.credit_limit_paise * 0.1
          ? 'bg-amber-100 text-amber-600'
          : 'bg-emerald-100 text-emerald-600';

  return (
    <div className="flex items-center justify-between gap-2 border-b border-slate-200 p-2">
      <div className="min-w-0">
        <p className="truncate text-sm font-medium text-slate-900">{customer.name}</p>
        <span className={`mt-0.5 inline-block rounded-full px-2 py-0.5 text-[10px] font-semibold ${chipTone}`}>
          {headroom === null
            ? t('pos.noCreditLimit')
            : headroom <= 0
              ? `${t('pos.atLimit')} ${formatPaise(customer.current_balance_paise)}`
              : `${t('pos.headroom')} ${formatPaise(headroom)} · ${t('pos.owes')} ${formatPaise(customer.current_balance_paise)}`}
        </span>
      </div>
      <button type="button" onClick={onClear} className="flex shrink-0 items-center gap-1 text-xs font-semibold text-slate-500 hover:text-rose-600">
        <X size={12} />
        {t('pos.remove')}
      </button>
    </div>
  );
}
