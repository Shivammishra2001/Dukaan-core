'use client';

import { useEffect, useMemo, useState } from 'react';
import { CheckCircle2, ClipboardList, Route, Truck } from 'lucide-react';
import { listB2bOrders, getLoadingSheet, dispatchB2bOrders, deliverB2bOrder } from '@/lib/b2b-client';
import { formatPaise } from '@/lib/money';
import { STORE_CONFIG } from '@/lib/mock-data';
import { useLanguage } from '@/context/LanguageContext';
import { dateLocale, translateEnum, translateError } from '@/lib/translations';
import type { B2bOrderLite, FreightTerms, LoadingSheetResponse } from '@/types/b2b';

const STATUS_STYLES: Record<string, string> = {
  BOOKED: 'bg-amber-100 text-amber-700',
  DISPATCHED: 'bg-blue-100 text-blue-700',
  DELIVERED: 'bg-emerald-100 text-emerald-700',
};

export default function DispatchPage() {
  const { t, language } = useLanguage();
  const [orders, setOrders] = useState<B2bOrderLite[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [routeFilter, setRouteFilter] = useState<string | null>(null);
  const [vehicleNo, setVehicleNo] = useState('');
  const [transporter, setTransporter] = useState('');
  const [driverName, setDriverName] = useState('');
  const [freightRupees, setFreightRupees] = useState('');
  const [freightTerms, setFreightTerms] = useState<FreightTerms>('PAID_BY_STORE');
  const [loadingSheet, setLoadingSheet] = useState<LoadingSheetResponse | null>(null);
  const [busy, setBusy] = useState(false);

  async function refresh() {
    setLoading(true);
    const res = await listB2bOrders('BOOKED');
    setLoading(false);
    if (!res.ok) {
      setError(`${t('dispatch.couldNotLoadOrders')} (${translateError(t, res.error)}) — ${t('dispatch.bookOrdersFirst')}`);
      setOrders([]);
      return;
    }
    setError(null);
    setOrders(res.data);
  }

  useEffect(() => {
    void refresh();
  }, []);

  const routes = useMemo(() => Array.from(new Set(orders.map((o) => o.route).filter((r): r is string => Boolean(r)))), [orders]);
  const visibleOrders = routeFilter ? orders.filter((o) => o.route === routeFilter) : orders;

  function toggle(id: string) {
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function handleGenerateLoadingSheet() {
    if (selected.size === 0) return;
    setBusy(true);
    const res = await getLoadingSheet(Array.from(selected));
    setBusy(false);
    if (!res.ok) return setError(res.error);
    setLoadingSheet(res.data);
  }

  async function handleDispatch() {
    if (selected.size === 0) return;
    setBusy(true);
    const res = await dispatchB2bOrders(Array.from(selected), {
      vehicle_no: vehicleNo || undefined,
      transporter: transporter || undefined,
      driver_name: driverName || undefined,
      freight_paise: freightRupees ? Math.round(Number(freightRupees) * 100) : undefined,
      freight_terms: freightTerms,
    });
    setBusy(false);
    if (!res.ok) return setError(res.error);
    printChallan(res.data, orders.filter((o) => selected.has(o.id)), t, dateLocale(language));
    setSelected(new Set());
    setLoadingSheet(null);
    void refresh();
  }

  async function handleDeliver(orderId: string) {
    setBusy(true);
    const res = await deliverB2bOrder(orderId);
    setBusy(false);
    if (!res.ok) return setError(res.error);
    void refresh();
  }

  return (
    <div className="w-full max-w-none px-4 py-6 sm:px-6 lg:px-8">
      <div className="flex items-center gap-3">
        <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-gradient-to-br from-amber-500 to-amber-600 text-white shadow-sm">
          <Truck size={20} />
        </span>
        <div>
          <h1 className="text-lg font-bold text-slate-900">{t('dispatch.title')}</h1>
          <p className="text-sm text-slate-500">{t('dispatch.subtitle')}</p>
        </div>
      </div>

      {error && <p className="mt-3 rounded-xl bg-amber-50 px-4 py-2.5 text-sm text-amber-700">{translateError(t, error)}</p>}

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => setRouteFilter(null)}
          className={`flex items-center gap-1 rounded-full px-3 py-1.5 text-xs font-bold transition ${!routeFilter ? 'bg-gradient-to-r from-primary to-accent text-white shadow-sm' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'}`}
        >
          <Route size={12} />
          {t('dispatch.allRoutes')}
        </button>
        {routes.map((r) => (
          <button
            key={r}
            type="button"
            onClick={() => setRouteFilter(r)}
            className={`rounded-full px-3 py-1.5 text-xs font-bold transition ${routeFilter === r ? 'bg-gradient-to-r from-primary to-accent text-white shadow-sm' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'}`}
          >
            {r}
          </button>
        ))}
      </div>

      <div className="mt-3 overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-sm">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs font-bold uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-3 py-2" />
              <th className="px-3 py-2">{t('dispatch.customer')}</th>
              <th className="px-3 py-2">{t('dispatch.route')}</th>
              <th className="px-3 py-2">{t('dispatch.booked')}</th>
              <th className="px-3 py-2 text-right">{t('dispatch.total')}</th>
              <th className="px-3 py-2">{t('dispatch.status')}</th>
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr>
                <td colSpan={7} className="px-3 py-6 text-center text-slate-500">
                  {t('common.loading')}
                </td>
              </tr>
            )}
            {!loading && visibleOrders.length === 0 && (
              <tr>
                <td colSpan={7} className="px-3 py-6 text-center text-slate-500">
                  {t('dispatch.noBookedOrders')}
                </td>
              </tr>
            )}
            {visibleOrders.map((o) => (
              <tr key={o.id} className="border-t border-slate-100">
                <td className="px-3 py-2">
                  <input type="checkbox" checked={selected.has(o.id)} onChange={() => toggle(o.id)} disabled={o.status !== 'BOOKED'} />
                </td>
                <td className="px-3 py-2 text-slate-900">{o.customer_name ?? '—'}</td>
                <td className="px-3 py-2 text-slate-500">{o.route ?? '—'}</td>
                <td className="px-3 py-2 text-slate-500">{new Date(o.booked_at).toLocaleString(dateLocale(language))}</td>
                <td className="px-3 py-2 text-right font-medium text-slate-900">{formatPaise(o.total_paise)}</td>
                <td className="px-3 py-2">
                  <span className={`rounded-full px-2.5 py-1 text-xs font-bold ${STATUS_STYLES[o.status] ?? 'bg-slate-100 text-slate-700'}`}>{translateEnum(t, 'enum.orderStatus', o.status)}</span>
                  {o.challan_no && <span className="ml-1.5 text-xs text-slate-400">{o.challan_no}</span>}
                </td>
                <td className="px-3 py-2 text-right">
                  {o.status === 'DISPATCHED' && (
                    <button
                      type="button"
                      onClick={() => handleDeliver(o.id)}
                      disabled={busy}
                      className="flex items-center gap-1 rounded-lg bg-gradient-to-r from-emerald-500 to-emerald-600 px-2.5 py-1.5 text-xs font-bold text-white shadow-sm transition active:scale-95"
                    >
                      <CheckCircle2 size={12} />
                      {t('dispatch.markDelivered')}
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="mt-4 rounded-2xl border border-slate-200/80 bg-white p-4 shadow-sm">
        <p className="text-xs font-bold uppercase tracking-wide text-slate-400">{t('dispatch.vehicleTransportation')}</p>
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <input
            value={vehicleNo}
            onChange={(e) => setVehicleNo(e.target.value)}
            placeholder={t('dispatch.vehicleNo')}
            className="min-h-[44px] rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-sm font-medium transition focus:border-primary focus:bg-white focus:outline-none focus:ring-4 focus:ring-primary/10"
          />
          <input
            value={transporter}
            onChange={(e) => setTransporter(e.target.value)}
            placeholder={t('dispatch.transporter')}
            className="min-h-[44px] rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-sm font-medium transition focus:border-primary focus:bg-white focus:outline-none focus:ring-4 focus:ring-primary/10"
          />
          <input
            value={driverName}
            onChange={(e) => setDriverName(e.target.value)}
            placeholder={t('dispatch.driverName')}
            className="min-h-[44px] rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-sm font-medium transition focus:border-primary focus:bg-white focus:outline-none focus:ring-4 focus:ring-primary/10"
          />
          <input
            type="number"
            inputMode="decimal"
            value={freightRupees}
            onChange={(e) => setFreightRupees(e.target.value)}
            placeholder={t('dispatch.freightRs')}
            className="min-h-[44px] w-32 rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-sm font-medium transition focus:border-primary focus:bg-white focus:outline-none focus:ring-4 focus:ring-primary/10"
          />
          <div className="flex overflow-hidden rounded-xl border border-slate-200">
            {(['PAID_BY_STORE', 'TO_PAY_BY_CUSTOMER'] as const).map((term) => (
              <button
                key={term}
                type="button"
                onClick={() => setFreightTerms(term)}
                className={`min-h-[44px] px-3 text-xs font-bold transition ${freightTerms === term ? 'bg-primary text-white' : 'bg-white text-slate-600 hover:bg-slate-50'}`}
              >
                {term === 'PAID_BY_STORE' ? t('dispatch.paidByStore') : t('dispatch.toPayByCustomer')}
              </button>
            ))}
          </div>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={handleGenerateLoadingSheet}
            disabled={selected.size === 0 || busy}
            className="flex min-h-[44px] items-center gap-1.5 rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-bold text-slate-700 transition hover:bg-slate-50 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40"
          >
            <ClipboardList size={15} />
            {t('dispatch.generateLoadingSheet')} ({selected.size})
          </button>
          <button
            type="button"
            onClick={handleDispatch}
            disabled={selected.size === 0 || busy}
            className="flex min-h-[44px] items-center gap-1.5 rounded-xl bg-gradient-to-r from-amber-500 to-amber-600 px-4 py-2.5 text-sm font-bold text-white shadow-md shadow-amber-500/25 transition hover:shadow-amber-500/40 active:scale-[0.98] disabled:cursor-not-allowed disabled:from-slate-300 disabled:to-slate-300 disabled:shadow-none"
          >
            <Truck size={15} />
            {t('dispatch.dispatchPrintChallan')}
          </button>
        </div>
      </div>

      {loadingSheet && (
        <div className="mt-4 rounded-2xl border border-slate-200/80 bg-white p-4 shadow-sm">
          <h2 className="flex items-center gap-1.5 text-sm font-bold text-slate-900">
            <ClipboardList size={15} className="text-slate-500" />
            {t('dispatch.loadingSheetTitle')} — {loadingSheet.order_count} {t('dispatch.orders')}
          </h2>
          <table className="mt-2 w-full text-sm">
            <thead className="text-left text-xs uppercase text-slate-500">
              <tr>
                <th className="py-1">{t('b2b.product')}</th>
                <th className="py-1 text-right">{t('dispatch.totalQty')}</th>
                <th className="py-1 text-right">{t('dispatch.packing')}</th>
              </tr>
            </thead>
            <tbody>
              {loadingSheet.lines.map((l) => (
                <tr key={l.product_id} className="border-t border-slate-100">
                  <td className="py-1 text-slate-900">{l.product_name}</td>
                  <td className="py-1 text-right text-slate-500">
                    {l.total_qty_base} {translateEnum(t, 'unit', l.base_unit)}
                  </td>
                  <td className="py-1 text-right font-medium text-slate-900">
                    {l.packing_qty_display} {translateEnum(t, 'unit', l.packing_unit)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/** A4 challan with supplier/buyer details, quantity, and a receiver signature box — window.print(), same pattern as lib/hardware/printer-transport.ts's fallback. */
function printChallan(dispatch: import('@/types/b2b').DispatchResponse, orders: B2bOrderLite[], t: (key: string) => string, locale: string) {
  const win = window.open('', '_blank', 'width=800,height=1000');
  if (!win) return;
  const rows = orders
    .map((o) => `<tr><td>${escapeHtml(o.customer_name ?? '')}</td><td>${escapeHtml(o.route ?? '')}</td><td style="text-align:right">${(o.total_paise / 100).toFixed(2)}</td></tr>`)
    .join('');
  const freightLine =
    dispatch.freight_paise > 0
      ? `<p>${t('dispatch.freight')}: ₹${(dispatch.freight_paise / 100).toFixed(2)} (${dispatch.freight_terms === 'TO_PAY_BY_CUSTOMER' ? t('dispatch.toPayByCustomer') : t('dispatch.paidByStore')})</p>`
      : '';
  win.document.write(`<!doctype html><html><head><meta charset="utf-8" /><title>${dispatch.challan_no}</title>
    <style>
      @page { size: A4; margin: 15mm; }
      body { font-family: Arial, sans-serif; font-size: 12px; color: #111; }
      h1 { font-size: 18px; margin: 0 0 4px; }
      table { width: 100%; border-collapse: collapse; margin-top: 12px; }
      th, td { border: 1px solid #999; padding: 6px 8px; text-align: left; }
      .sign-box { margin-top: 60px; display: flex; justify-content: space-between; }
      .sign-box div { width: 45%; border-top: 1px solid #333; padding-top: 4px; text-align: center; }
    </style></head><body>
    <h1>${t('dispatch.deliveryChallan')}</h1>
    <p>${escapeHtml(STORE_CONFIG.store_name)} — ${t('dispatch.challanNo')}: <b>${dispatch.challan_no}</b></p>
    <p>${t('common.date')}: ${new Date().toLocaleDateString(locale)} &nbsp; ${t('dispatch.vehicleNo')}: ${escapeHtml(dispatch.vehicle_no || '-')}</p>
    <p>${t('dispatch.transporter')}: ${escapeHtml(dispatch.transporter || '-')} &nbsp; ${t('dispatch.driverName')}: ${escapeHtml(dispatch.driver_name || '-')}</p>
    ${freightLine}
    <table><thead><tr><th>${t('dispatch.customer')}</th><th>${t('dispatch.route')}</th><th style="text-align:right">${t('khata.amountRs')}</th></tr></thead><tbody>${rows}</tbody></table>
    <div class="sign-box"><div>${t('dispatch.dispatchedBy')}</div><div>${t('dispatch.receiverSignature')}</div></div>
    <script>window.onload = () => window.print();</script>
    </body></html>`);
  win.document.close();
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
