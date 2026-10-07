'use client';

import { usePosStore } from '@/stores/pos-store';
import { useLanguage } from '@/context/LanguageContext';

export function ParkedCartsPanel({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useLanguage();
  const parkedCarts = usePosStore((s) => s.parked_carts);
  const resume = usePosStore((s) => s.resume);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-end bg-white/30 p-4" onClick={onClose}>
      <div
        className="mt-14 w-full max-w-xs rounded-xl border border-slate-200 bg-slate-50 p-3 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="mb-2 text-sm font-semibold text-slate-900">{t('pos.parkedCartsTitle')}</h2>
        {parkedCarts.length === 0 ? (
          <p className="text-xs text-slate-500">{t('pos.nothingParked')}</p>
        ) : (
          <ul className="space-y-1.5">
            {parkedCarts.map((p) => (
              <li key={p.cart_uuid} className="flex items-center justify-between rounded-md bg-white px-2.5 py-2 text-sm">
                <div className="min-w-0">
                  <p className="truncate font-medium text-slate-800">{p.label === 'Auto-parked' ? t('pos.autoParked') : p.label}</p>
                  <p className="text-xs text-slate-500">{p.lines.length} {t('pos.itemsCount')}</p>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    resume(p.cart_uuid);
                    onClose();
                  }}
                  className="shrink-0 rounded bg-emerald-600 px-2.5 py-1 text-xs font-semibold text-white hover:bg-emerald-500"
                >
                  {t('pos.resume')}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
