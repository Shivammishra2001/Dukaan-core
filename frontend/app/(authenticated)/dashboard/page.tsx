'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  AlertTriangle,
  ArrowRight,
  ArrowUpRight,
  Banknote,
  Boxes,
  Monitor,
  PackagePlus,
  Receipt,
  RefreshCw,
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
import { dateLocale, translateEnum, translateError } from '@/lib/translations';

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

/** Shape of Strapi's GET /api/dashboard-summary (backend/src/api/dashboard/services/dashboard.ts). */
interface DashboardSummary {
  business_date: string;
  sales: {
    today_paise: number;
    yesterday_paise: number;
    bills_today: number;
    bills_yesterday: number;
    returns_today_paise: number;
    trend: Array<{ date: string; sales_paise: number; bills: number }>;
  };
  khata: { outstanding_paise: number; customers_with_dues: number };
  payables: { outstanding_paise: number; suppliers_with_dues: number };
  customers: { active: number };
  counters: { active: number; total: number };
  shifts: { live: Array<{ counter_code: string | null; counter_name: string | null; cashier_name: string | null; status: string; opened_at: string | null; bill_count: number }> };
  low_stock: { count: number; items: Array<{ product_id: string; name: string; base_unit: string | null; stock_base: number; reorder_level_base: number }> };
  recent_orders: Array<{
    order_id: string;
    invoice_no: string | null;
    provisional_no: string | null;
    order_type: string;
    status: string;
    total_paise: number;
    customer_name: string | null;
    counter_code: string | null;
    created_at: string | null;
  }>;
}

/** Live numbers: polled while the tab is visible and refetched on focus, so a bill rung up on /pos shows here within seconds. */
const POLL_MS = 30_000;

function useDashboardSummary() {
  const [data, setData] = useState<DashboardSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);
  const inFlight = useRef<AbortController | null>(null);

  const load = useCallback(async () => {
    inFlight.current?.abort();
    const controller = new AbortController();
    inFlight.current = controller;
    setLoading(true);
    try {
      const res = await fetch('/api/dashboard/summary', { cache: 'no-store', signal: controller.signal });
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error(body?.error?.code ?? `HTTP_${res.status}`);
      setData(body.data as DashboardSummary);
      setError(null);
      setUpdatedAt(new Date());
    } catch (err) {
      if (controller.signal.aborted) return;
      setError(err instanceof Error ? err.message : 'ERR_NETWORK');
    } finally {
      if (inFlight.current === controller) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') void load();
    }, POLL_MS);
    const onVisible = () => {
      if (document.visibilityState === 'visible') void load();
    };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', onVisible);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', onVisible);
      inFlight.current?.abort();
    };
  }, [load]);

  return { data, error, loading, updatedAt, reload: load };
}

function percentChange(today: number, yesterday: number): number | null {
  if (yesterday <= 0) return null;
  return Math.round(((today - yesterday) / yesterday) * 100);
}

function Skeleton({ className = '' }: { className?: string }) {
  return <div className={`animate-pulse rounded-md bg-slate-100 ${className}`} />;
}

function Card({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <div className={`rounded-2xl border border-slate-200/80 bg-white p-4 shadow-sm ${className}`}>{children}</div>;
}

export default function DashboardPage() {
  const { profile, loading: sessionLoading } = useSession();
  const { t, language } = useLanguage();
  const { data, error, loading, updatedAt, reload } = useDashboardSummary();

  const locale = dateLocale(language);
  const timeFmt = new Intl.DateTimeFormat(locale, { hour: 'numeric', minute: '2-digit' });
  const qtyFmt = new Intl.NumberFormat(locale, { maximumFractionDigits: 3 });
  const showSkeleton = !data && loading;

  const kpis = data
    ? [
        {
          key: 'sales',
          label: t('dashboard.kpiTodaySales'),
          value: formatPaise(data.sales.today_paise),
          change: percentChange(data.sales.today_paise, data.sales.yesterday_paise),
          higherIsGood: true,
          footnote: data.sales.returns_today_paise > 0 ? t('dashboard.returnsToday').replace('{amount}', formatPaise(data.sales.returns_today_paise)) : null,
          points: data.sales.trend.map((d) => d.sales_paise),
          tone: '#059669',
          icon: Banknote,
        },
        {
          key: 'bills',
          label: t('dashboard.kpiBillsToday'),
          value: String(data.sales.bills_today),
          change: percentChange(data.sales.bills_today, data.sales.bills_yesterday),
          higherIsGood: true,
          footnote: null,
          points: data.sales.trend.map((d) => d.bills),
          tone: '#2563eb',
          icon: Receipt,
        },
        {
          key: 'khata',
          label: t('dashboard.kpiOutstandingKhata'),
          value: formatPaise(data.khata.outstanding_paise),
          change: undefined,
          higherIsGood: false,
          footnote: t('dashboard.customersWithDues').replace('{n}', String(data.khata.customers_with_dues)),
          points: null,
          tone: '#e11d48',
          icon: Users,
        },
        {
          key: 'payables',
          label: t('dashboard.kpiPayableSuppliers'),
          value: formatPaise(data.payables.outstanding_paise),
          change: undefined,
          higherIsGood: false,
          footnote: t('dashboard.suppliersWithDues').replace('{n}', String(data.payables.suppliers_with_dues)),
          points: null,
          tone: '#d97706',
          icon: Wallet,
        },
      ]
    : [];

  return (
    <div className="mx-auto max-w-6xl p-4 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-bold text-slate-900">
            {sessionLoading ? t('common.loading') : `${t('dashboard.welcomeBack')}${profile ? `, ${profile.user.full_name}` : ''}`}
          </h1>
          <p className="mt-0.5 text-sm text-slate-500">{t('dashboard.happeningAt').replace('{store}', profile?.store.name ?? t('dashboard.yourStore'))}</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => void reload()}
            disabled={loading}
            className="flex min-h-[48px] items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-600 transition hover:bg-slate-50 disabled:opacity-60"
            title={t('dashboard.refresh')}
          >
            <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
            <span className="hidden sm:inline">
              {updatedAt ? t('dashboard.updatedAt').replace('{time}', timeFmt.format(updatedAt)) : t('dashboard.refresh')}
            </span>
          </button>
          <a
            href="/pos"
            className="flex min-h-[48px] items-center gap-1.5 rounded-lg bg-gradient-to-r from-emerald-500 to-emerald-600 px-4 text-sm font-bold text-white shadow-md shadow-emerald-500/25 transition hover:shadow-emerald-500/40 active:scale-[0.98]"
          >
            <ShoppingCart size={16} />
            {t('dashboard.openPos')}
          </a>
        </div>
      </div>

      {error && (
        <div role="alert" className="mt-4 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
          <span className="flex items-center gap-2">
            <AlertTriangle size={16} />
            {t('dashboard.loadError')} {translateError(t, error)}
          </span>
          <button type="button" onClick={() => void reload()} className="min-h-[40px] rounded-lg bg-white px-3 font-semibold text-rose-700 shadow-sm hover:bg-rose-100">
            {t('dashboard.retry')}
          </button>
        </div>
      )}

      <div className="mt-6">
        {/* KPI banner */}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {showSkeleton || !data
            ? Array.from({ length: 4 }, (_, i) => (
                <Card key={i}>
                  <Skeleton className="h-3 w-24" />
                  <Skeleton className="mt-3 h-7 w-32" />
                  <Skeleton className="mt-4 h-7 w-full" />
                </Card>
              ))
            : kpis.map((kpi) => {
                const Icon = kpi.icon;
                const up = (kpi.change ?? 0) >= 0;
                const good = kpi.higherIsGood ? up : !up;
                return (
                  <Card key={kpi.key}>
                    <div className="flex items-start justify-between">
                      <div>
                        <p className="text-xs font-semibold text-slate-500">{kpi.label}</p>
                        <p className="mt-1 text-2xl font-black tabular-nums text-slate-900">{kpi.value}</p>
                      </div>
                      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-slate-50 text-slate-400">
                        <Icon size={16} />
                      </span>
                    </div>
                    <div className="mt-2 flex min-h-[16px] items-center justify-between text-xs">
                      {kpi.change === null ? (
                        <span className="font-medium text-slate-400">{t('dashboard.noComparison')}</span>
                      ) : kpi.change !== undefined ? (
                        <span className={`flex items-center gap-0.5 font-bold ${good ? 'text-emerald-600' : 'text-rose-600'}`}>
                          <ArrowUpRight size={12} className={up ? '' : 'rotate-90'} />
                          {kpi.change > 0 ? '+' : ''}
                          {kpi.change}% <span className="font-medium text-slate-400">{t('dashboard.vsYesterday')}</span>
                        </span>
                      ) : (
                        <span className="font-medium text-slate-500">{kpi.footnote}</span>
                      )}
                    </div>
                    {kpi.points ? (
                      <div className="mt-1.5" title={t('dashboard.trend7d')}>
                        <Sparkline points={kpi.points} tone={kpi.tone} />
                      </div>
                    ) : null}
                    {kpi.points && kpi.footnote ? <p className="mt-1 text-xs font-medium text-slate-500">{kpi.footnote}</p> : null}
                  </Card>
                );
              })}
        </div>

        {/* Live operations */}
        <div className="mt-3 grid grid-cols-1 gap-3 lg:grid-cols-3">
          <Card>
            <div className="flex items-center justify-between">
              <p className="flex items-center gap-1.5 text-sm font-bold text-slate-700">
                <Monitor size={16} className="text-slate-400" />
                {t('dashboard.liveShifts')}
              </p>
              {data && (
                <span className="text-xs font-semibold text-slate-500">
                  {t('dashboard.countersOpen').replace('{open}', String(data.shifts.live.length)).replace('{total}', String(data.counters.active))}
                </span>
              )}
            </div>
            {!data ? (
              <div className="mt-3 space-y-2">
                <Skeleton className="h-10 w-full" />
                <Skeleton className="h-10 w-full" />
              </div>
            ) : data.shifts.live.length === 0 ? (
              <p className="mt-4 text-sm text-slate-500">{t('dashboard.noLiveShifts')}</p>
            ) : (
              <ul className="mt-3 space-y-2">
                {data.shifts.live.map((s, i) => (
                  <li key={`${s.counter_code}-${i}`} className="flex items-center justify-between rounded-lg bg-emerald-50/60 px-3 py-2 text-sm">
                    <span>
                      <span className="font-bold text-slate-800">{s.counter_name ?? s.counter_code}</span>
                      <span className="block text-xs text-slate-500">
                        {s.cashier_name}
                        {s.opened_at ? ` · ${t('dashboard.since').replace('{time}', timeFmt.format(new Date(s.opened_at)))}` : ''}
                      </span>
                    </span>
                    <span className="text-right text-xs font-semibold text-slate-600">
                      {t('dashboard.billsCount').replace('{n}', String(s.bill_count))}
                      <span className="block font-medium text-slate-400">{translateEnum(t, 'enum.shiftStatus', s.status)}</span>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card>
            <div className="flex items-center justify-between">
              <p className="flex items-center gap-1.5 text-sm font-bold text-slate-700">
                <AlertTriangle size={16} className={data && data.low_stock.count > 0 ? 'text-amber-500' : 'text-slate-400'} />
                {t('dashboard.lowStock')}
              </p>
              {data && data.low_stock.count > 0 && (
                <a href="/inventory" className="text-xs font-semibold text-emerald-700 hover:underline">
                  {t('dashboard.lowStockViewAll').replace('{n}', String(data.low_stock.count))}
                </a>
              )}
            </div>
            {!data ? (
              <div className="mt-3 space-y-2">
                <Skeleton className="h-5 w-full" />
                <Skeleton className="h-5 w-full" />
                <Skeleton className="h-5 w-2/3" />
              </div>
            ) : data.low_stock.items.length === 0 ? (
              <p className="mt-4 text-sm text-slate-500">{t('dashboard.noLowStock')}</p>
            ) : (
              <ul className="mt-3 divide-y divide-slate-100 text-sm">
                {data.low_stock.items.map((p) => (
                  <li key={p.product_id} className="flex items-center justify-between py-1.5">
                    <span className="truncate pr-2 text-slate-700">{p.name}</span>
                    <span className={`shrink-0 font-semibold tabular-nums ${p.stock_base <= 0 ? 'text-rose-600' : 'text-amber-600'}`}>
                      {qtyFmt.format(p.stock_base)} {p.base_unit ?? ''}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card>
            <p className="flex items-center gap-1.5 text-sm font-bold text-slate-700">
              <Users size={16} className="text-slate-400" />
              {t('dashboard.customers')}
            </p>
            {!data ? (
              <Skeleton className="mt-3 h-9 w-24" />
            ) : (
              <>
                <p className="mt-2 text-3xl font-black tabular-nums text-slate-900">{data.customers.active}</p>
                <p className="text-xs font-medium text-slate-500">{t('dashboard.activeCustomers')}</p>
                {data.khata.customers_with_dues > 0 && (
                  <a href="/customers/ledger" className="mt-3 inline-block text-xs font-semibold text-rose-600 hover:underline">
                    {t('dashboard.customersWithDues').replace('{n}', String(data.khata.customers_with_dues))} · {formatPaise(data.khata.outstanding_paise)}
                  </a>
                )}
              </>
            )}
          </Card>
        </div>

        {/* Recent bills */}
        <Card className="mt-3 p-0">
          <p className="flex items-center gap-1.5 px-4 pt-4 text-sm font-bold text-slate-700">
            <Receipt size={16} className="text-slate-400" />
            {t('dashboard.recentBills')}
          </p>
          {!data ? (
            <div className="space-y-2 p-4">
              {Array.from({ length: 4 }, (_, i) => (
                <Skeleton key={i} className="h-8 w-full" />
              ))}
            </div>
          ) : data.recent_orders.length === 0 ? (
            <div className="flex flex-wrap items-center justify-between gap-3 p-4">
              <p className="text-sm text-slate-500">{t('dashboard.noBills')}</p>
              <a href="/pos" className="flex min-h-[40px] items-center gap-1 rounded-lg bg-emerald-50 px-3 text-sm font-semibold text-emerald-700 hover:bg-emerald-100">
                {t('dashboard.openPos')} <ArrowRight size={14} />
              </a>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="mt-2 w-full min-w-[560px] text-sm">
                <thead>
                  <tr className="border-b border-slate-100 text-left text-xs font-semibold text-slate-500">
                    <th className="px-4 py-2">{t('dashboard.colBill')}</th>
                    <th className="px-4 py-2">{t('dashboard.colTime')}</th>
                    <th className="px-4 py-2">{t('dashboard.colCustomer')}</th>
                    <th className="px-4 py-2 text-right">{t('dashboard.colAmount')}</th>
                    <th className="px-4 py-2">{t('dashboard.colStatus')}</th>
                  </tr>
                </thead>
                <tbody>
                  {data.recent_orders.map((o) => (
                    <tr key={o.order_id} className="border-b border-slate-50 last:border-0">
                      <td className="px-4 py-2 font-mono text-xs text-slate-700">
                        {o.invoice_no ?? o.provisional_no ?? '—'}
                        {o.order_type === 'RETURN' && <span className="ml-1.5 rounded bg-amber-100 px-1.5 py-0.5 font-sans text-[10px] font-bold text-amber-700">{t('dashboard.returnBill')}</span>}
                      </td>
                      <td className="px-4 py-2 text-slate-500">
                        {o.created_at ? new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }).format(new Date(o.created_at)) : '—'}
                      </td>
                      <td className="px-4 py-2 text-slate-700">{o.customer_name ?? t('dashboard.walkIn')}</td>
                      <td className="px-4 py-2 text-right font-semibold tabular-nums text-slate-900">{formatPaise(o.total_paise)}</td>
                      <td className="px-4 py-2 text-xs text-slate-500">{translateEnum(t, 'enum.orderStatus', o.status)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>

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
