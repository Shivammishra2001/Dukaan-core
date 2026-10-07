'use client';

import {
  ArrowRight,
  ArrowUpRight,
  Banknote,
  Boxes,
  PackagePlus,
  Receipt,
  ShoppingCart,
  Truck,
  Users,
  Wallet,
  type LucideIcon,
} from 'lucide-react';
import { useSession } from '@/hooks/use-session';
import { formatPaise } from '@/lib/money';
import { Sparkline } from '@/components/ui/sparkline';
import { useLanguage } from '@/context/LanguageContext';

interface ActionCard {
  href: string;
  titleKey: string;
  subtitleKey: string;
  icon: LucideIcon;
  gradient: string;
  available: boolean;
}

const ACTIONS: ActionCard[] = [
  { href: '/pos', titleKey: 'dashboard.actionPos', subtitleKey: 'dashboard.actionPosSub', icon: ShoppingCart, gradient: 'from-emerald-500 to-emerald-600', available: true },
  { href: '/b2b/purchases', titleKey: 'dashboard.actionPurchase', subtitleKey: 'dashboard.actionPurchaseSub', icon: PackagePlus, gradient: 'from-blue-600 to-indigo-600', available: true },
  { href: '/b2b/dispatch', titleKey: 'dashboard.actionDispatch', subtitleKey: 'dashboard.actionDispatchSub', icon: Truck, gradient: 'from-amber-500 to-amber-600', available: true },
  { href: '/customers/ledger', titleKey: 'dashboard.actionKhata', subtitleKey: 'dashboard.actionKhataSub', icon: Users, gradient: 'from-rose-500 to-rose-600', available: true },
  { href: '/inventory', titleKey: 'dashboard.actionInventory', subtitleKey: 'dashboard.actionInventorySub', icon: Boxes, gradient: 'from-teal-500 to-teal-700', available: true },
  { href: '/b2b/suppliers', titleKey: 'dashboard.actionSuppliers', subtitleKey: 'dashboard.actionSuppliersSub', icon: Receipt, gradient: 'from-indigo-600 to-blue-700', available: true },
  { href: '/reports/shifts', titleKey: 'dashboard.actionShifts', subtitleKey: 'dashboard.actionShiftsSub', icon: Wallet, gradient: 'from-slate-600 to-slate-800', available: true },
];

/** Illustrative KPI numbers — no analytics endpoint exists yet (out of this pass's scope); sparklines are static demo trends, not live time-series. */
const KPI_CARDS = [
  { labelKey: 'dashboard.kpiTodaySales', value: 48_320_00, change: '+14%', good: true, points: [30, 42, 38, 55, 48, 62, 58], tone: '#059669', icon: Banknote },
  { labelKey: 'dashboard.kpiBillsToday', value: 27, isCount: true, change: '+6%', good: true, points: [4, 6, 5, 8, 7, 9, 10], tone: '#2563eb', icon: Receipt },
  { labelKey: 'dashboard.kpiOutstandingKhata', value: 12_400_00, change: '-3%', good: true, points: [14, 13, 15, 12, 13, 11, 12], tone: '#e11d48', icon: Users },
  { labelKey: 'dashboard.kpiPayableSuppliers', value: 96_500_00, change: '+2%', good: false, points: [80, 85, 88, 90, 92, 94, 96], tone: '#d97706', icon: Wallet },
];

export default function DashboardPage() {
  const { profile, loading } = useSession();
  const { t } = useLanguage();

  return (
    <div className="mx-auto max-w-6xl p-4 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-bold text-slate-900">
            {loading ? t('common.loading') : `${t('dashboard.welcomeBack')}${profile ? `, ${profile.user.full_name}` : ''}`}
          </h1>
          <p className="mt-0.5 text-sm text-slate-500">{t('dashboard.happeningAt').replace('{store}', profile?.store.name ?? t('dashboard.yourStore'))}</p>
        </div>
        <a
          href="/pos"
          className="flex min-h-[48px] items-center gap-1.5 rounded-lg bg-gradient-to-r from-emerald-500 to-emerald-600 px-4 text-sm font-bold text-white shadow-md shadow-emerald-500/25 transition hover:shadow-emerald-500/40 active:scale-[0.98]"
        >
          <ShoppingCart size={16} />
          {t('dashboard.openPos')}
        </a>
      </div>

      <div className="mt-6">
        {/* KPI banner */}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {KPI_CARDS.map((kpi) => {
            const Icon = kpi.icon;
            return (
              <div key={kpi.labelKey} className="rounded-2xl border border-slate-200/80 bg-white p-4 shadow-sm">
                <div className="flex items-start justify-between">
                  <div>
                    <p className="text-xs font-semibold text-slate-500">{t(kpi.labelKey)}</p>
                    <p className="mt-1 text-2xl font-black tabular-nums text-slate-900">
                      {kpi.isCount ? kpi.value : formatPaise(kpi.value)}
                    </p>
                  </div>
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-slate-50 text-slate-400">
                    <Icon size={16} />
                  </span>
                </div>
                <div className="mt-2 flex items-center justify-between">
                  <span className={`flex items-center gap-0.5 text-xs font-bold ${kpi.good ? 'text-emerald-600' : 'text-rose-600'}`}>
                    <ArrowUpRight size={12} className={kpi.change.startsWith('-') ? 'rotate-90' : ''} />
                    {kpi.change} <span className="font-medium text-slate-400">{t('dashboard.vsYesterday')}</span>
                  </span>
                </div>
                <div className="mt-1.5">
                  <Sparkline points={kpi.points} tone={kpi.tone} />
                </div>
              </div>
            );
          })}
        </div>

        {/* Action matrix */}
        <h2 className="mb-3 mt-8 text-sm font-bold text-slate-500">{t('dashboard.whatToDo')}</h2>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {ACTIONS.map((card) => {
            const Icon = card.icon;
            return (
              <a
                key={card.href}
                href={card.available ? card.href : undefined}
                aria-disabled={!card.available}
                className={`group relative overflow-hidden rounded-2xl border p-5 transition ${
                  card.available
                    ? 'border-slate-200/80 bg-white hover:-translate-y-1 hover:border-transparent hover:shadow-xl hover:shadow-slate-300/40'
                    : 'cursor-not-allowed border-slate-100 bg-slate-50 opacity-60'
                }`}
              >
                <span className={`flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-br ${card.gradient} text-white shadow-sm`}>
                  <Icon size={22} strokeWidth={2.25} />
                </span>
                <p className="mt-3 font-bold text-slate-900">{t(card.titleKey)}</p>
                <p className="text-sm text-slate-500">{t(card.subtitleKey)}</p>
                {card.available ? (
                  <ArrowRight size={16} className="mt-3 text-slate-300 transition group-hover:translate-x-1 group-hover:text-slate-500" />
                ) : (
                  <p className="mt-3 text-xs font-bold text-amber-600">{t('dashboard.comingSoon')}</p>
                )}
              </a>
            );
          })}
        </div>
      </div>
    </div>
  );
}
