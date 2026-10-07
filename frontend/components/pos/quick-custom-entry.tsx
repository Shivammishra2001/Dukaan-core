'use client';

import { useState } from 'react';
import { Calculator, Delete, X } from 'lucide-react';
import { buildCustomProduct } from '@/lib/custom-entry';
import { useLanguage } from '@/context/LanguageContext';
import type { Product } from '@/types/pos';

const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '.', '0', '⌫'];

interface QuickCustomEntryProps {
  open: boolean;
  onClose: () => void;
  onAdd: (product: Product) => void;
}

/**
 * "Universal" in the sense that it works identically regardless of
 * business preset — a DHABA table charge, a SALOON custom package, a
 * REPAIR one-off part, or a KIRANA miscellaneous sale are all the same
 * shape: an amount and an optional description.
 */
export function QuickCustomEntry({ open, onClose, onAdd }: QuickCustomEntryProps) {
  const { t } = useLanguage();
  const [amount, setAmount] = useState('');
  const [description, setDescription] = useState('');

  if (!open) return null;

  function pressKey(key: string) {
    if (key === '⌫') {
      setAmount((a) => a.slice(0, -1));
      return;
    }
    if (key === '.' && amount.includes('.')) return;
    setAmount((a) => (a + key).slice(0, 10));
  }

  function handleAdd() {
    const paise = Math.round(Number(amount || '0') * 100);
    if (!Number.isFinite(paise) || paise <= 0) return;
    onAdd(buildCustomProduct(description, paise));
    setAmount('');
    setDescription('');
    onClose();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4 backdrop-blur-sm">
      <div className="w-full max-w-xs rounded-2xl border border-slate-200/80 bg-white p-4 shadow-2xl">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="flex items-center gap-2 text-sm font-bold text-slate-900">
            <Calculator size={16} className="text-primary" />
            {t('pos.khulaHisaab')}
          </h2>
          <button type="button" onClick={onClose} className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700" aria-label={t('common.close')}>
            <X size={16} />
          </button>
        </div>

        <div className="rounded-xl bg-slate-50 px-3 py-3.5 text-right text-3xl font-black tabular-nums text-slate-900">₹{amount || '0'}</div>

        <input
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder={t('pos.descriptionOptional')}
          className="mt-2.5 w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-900 transition focus:border-primary focus:outline-none focus:ring-4 focus:ring-primary/10"
        />

        <div className="mt-3 grid grid-cols-3 gap-2">
          {KEYS.map((key) => (
            <button
              key={key}
              type="button"
              onClick={() => pressKey(key)}
              className="flex h-12 items-center justify-center rounded-xl bg-slate-100 text-lg font-bold text-slate-800 transition hover:bg-slate-200 active:scale-95"
            >
              {key === '⌫' ? <Delete size={18} /> : key}
            </button>
          ))}
        </div>

        <button
          type="button"
          onClick={handleAdd}
          disabled={!amount}
          className="mt-3 w-full rounded-xl bg-gradient-to-r from-emerald-500 to-emerald-600 py-3 text-sm font-bold text-white shadow-md shadow-emerald-500/25 transition active:scale-[0.98] disabled:cursor-not-allowed disabled:from-slate-300 disabled:to-slate-300 disabled:shadow-none"
        >
          {t('pos.addToCart')}
        </button>
      </div>
    </div>
  );
}
