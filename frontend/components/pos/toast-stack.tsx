'use client';

import { useLanguage } from '@/context/LanguageContext';
import { translateError } from '@/lib/translations';

export interface Toast {
  id: number;
  message: string;
  tone: 'error' | 'success';
}

export function ToastStack({ toasts }: { toasts: Toast[] }) {
  const { t } = useLanguage();
  if (toasts.length === 0) return null;
  return (
    <div className="pointer-events-none fixed bottom-4 left-1/2 z-[60] flex -translate-x-1/2 flex-col gap-2">
      {toasts.map((toast) => (
        <div
          key={toast.id}
          className={`rounded-md px-4 py-2 text-sm font-medium shadow-lg ${
            toast.tone === 'error' ? 'bg-rose-600 text-white' : 'bg-emerald-600 text-white'
          }`}
        >
          {translateError(t, toast.message)}
        </div>
      ))}
    </div>
  );
}
