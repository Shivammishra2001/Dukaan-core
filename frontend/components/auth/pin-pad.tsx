'use client';

import { Delete } from 'lucide-react';
import { useLanguage } from '@/context/LanguageContext';

interface PinPadProps {
  value: string;
  onChange: (value: string) => void;
  maxLength?: number;
}

const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', 'del'] as const;

/** Big touch-target numeric pad for shared-terminal cashier PIN login. */
export function PinPad({ value, onChange, maxLength = 6 }: PinPadProps) {
  const { t } = useLanguage();
  function press(key: (typeof KEYS)[number]) {
    if (key === '') return;
    if (key === 'del') return onChange(value.slice(0, -1));
    if (value.length >= maxLength) return;
    onChange(value + key);
  }

  return (
    <div className="grid grid-cols-3 gap-3">
      {KEYS.map((key, i) => {
        if (key === '') return <span key={`blank-${i}`} />;
        if (key === 'del') {
          return (
            <button
              key="del"
              type="button"
              onClick={() => press('del')}
              aria-label={t('auth.deleteDigit')}
              className="flex h-14 items-center justify-center rounded-xl bg-slate-100 text-slate-600 transition hover:bg-slate-200 active:scale-95"
            >
              <Delete size={20} />
            </button>
          );
        }
        return (
          <button
            key={key}
            type="button"
            onClick={() => press(key)}
            className="h-14 rounded-xl bg-slate-100 text-xl font-semibold text-slate-900 transition hover:bg-slate-200 active:scale-95"
          >
            {key}
          </button>
        );
      })}
    </div>
  );
}
