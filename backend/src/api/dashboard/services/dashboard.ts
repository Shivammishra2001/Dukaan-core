import type { Knex } from 'knex';
import { AppError } from '../../../services/errors';
import { businessDateIso } from '../../../services/business-date';

/**
 * Read-only aggregates for the owner dashboard, scoped to one store. Orders are
 * bucketed by `business_date` (written by checkout with the same
 * businessDateIso helper), so "today" here always matches the POS's day.
 */

const SOLD_STATUSES = ['COMPLETED', 'PARTIALLY_RETURNED', 'RETURNED'];
const LIVE_SHIFT_STATUSES = ['OPEN', 'PENDING_COUNT'];
const TREND_DAYS = 7;

// Postgres returns BIGINT/NUMERIC aggregates as strings; SQLite returns numbers.
const num = (v: unknown): number => (v == null ? 0 : Number(v));

// pg parses DATE columns into a local-midnight Date; SQLite keeps the ISO text.
function isoDay(v: unknown): string {
  if (v instanceof Date) {
    return `${v.getFullYear()}-${String(v.getMonth() + 1).padStart(2, '0')}-${String(v.getDate()).padStart(2, '0')}`;
  }
  return String(v).slice(0, 10);
}

function shiftIsoDay(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export interface DashboardSummary {
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
  shifts: {
    live: Array<{ counter_code: string | null; counter_name: string | null; cashier_name: string | null; status: string; opened_at: string | null; bill_count: number }>;
  };
  low_stock: {
    count: number;
    items: Array<{ product_id: string; name: string; base_unit: string | null; stock_base: number; reorder_level_base: number }>;
  };
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

export async function getDashboardSummary(storeDocumentId: string): Promise<DashboardSummary> {
  const knex: Knex = strapi.db.connection;

  const store = await knex('stores').where({ document_id: storeDocumentId }).first('id');
  if (!store) throw new AppError('ERR_STORE_MISMATCH', 403, `Unknown store ${storeDocumentId}`);
  const storeId: number = store.id;

  const today = businessDateIso(new Date());
  const yesterday = shiftIsoDay(today, -1);
  const trendStart = shiftIsoDay(today, -(TREND_DAYS - 1));

  const salesByDay = knex('orders')
    .where({ store_id: storeId, order_type: 'SALE' })
    .whereIn('status', SOLD_STATUSES)
    .whereBetween('business_date', [trendStart, today])
    .groupBy('business_date')
    .select('business_date')
    .sum({ sales_paise: 'total_paise' })
    .count({ bills: '*' });

  const returnsToday = knex('orders')
    .where({ store_id: storeId, order_type: 'RETURN', business_date: today })
    .whereNot('status', 'CANCELLED')
    .first(knex.raw('COALESCE(SUM(ABS(total_paise)), 0) AS returns_paise'));

  const khata = knex('customers')
    .where({ store_id: storeId })
    .where('current_balance_paise', '>', 0)
    .first(knex.raw('COALESCE(SUM(current_balance_paise), 0) AS outstanding_paise'), knex.raw('COUNT(*) AS n'));

  const payables = knex('suppliers')
    .where({ store_id: storeId })
    .where('current_balance_paise', '>', 0)
    .first(knex.raw('COALESCE(SUM(current_balance_paise), 0) AS outstanding_paise'), knex.raw('COUNT(*) AS n'));

  const activeCustomers = knex('customers').where({ store_id: storeId, is_active: true }).first(knex.raw('COUNT(*) AS n'));

  const counters = knex('counters')
    .where({ store_id: storeId })
    .first(knex.raw('COUNT(*) AS total'), knex.raw('SUM(CASE WHEN is_active THEN 1 ELSE 0 END) AS active'));

  const liveShifts = knex('shifts as s')
    .leftJoin('counters as c', 'c.id', 's.counter_id')
    .leftJoin('app_users as u', 'u.id', 's.cashier_id')
    .where('s.store_id', storeId)
    .whereIn('s.status', LIVE_SHIFT_STATUSES)
    .orderBy('s.opened_at', 'asc')
    .select('c.code as counter_code', 'c.name as counter_name', 'u.full_name as cashier_name', 's.status', 's.opened_at', 's.bill_count');

  // Stock on hand = Σ current_stock_base over ACTIVE batches. "Low" = at/below the
  // product's reorder level, or out of stock when no reorder level is set.
  const stockPerProduct = knex('products as p')
    .leftJoin('inventory_batches as b', function joinActiveBatches() {
      this.on('b.product_id', '=', 'p.id').andOn('b.status', '=', knex.raw('?', ['ACTIVE']));
    })
    .where('p.store_id', storeId)
    .where('p.is_active', true)
    .where((qb) => qb.where('p.is_service', false).orWhereNull('p.is_service'))
    .groupBy('p.id', 'p.document_id', 'p.name', 'p.base_unit', 'p.reorder_level_base')
    .select('p.document_id as product_id', 'p.name', 'p.base_unit', 'p.reorder_level_base')
    .select(knex.raw('COALESCE(SUM(b.current_stock_base), 0) AS stock_base'))
    .havingRaw(
      'COALESCE(SUM(b.current_stock_base), 0) <= CASE WHEN COALESCE(p.reorder_level_base, 0) > 0 THEN p.reorder_level_base ELSE 0 END'
    );

  const lowStockItems = knex.from(stockPerProduct.clone().as('t')).select('*').orderBy('stock_base', 'asc').limit(5);
  const lowStockCount = knex.from(stockPerProduct.clone().as('t')).first(knex.raw('COUNT(*) AS n'));

  const recentOrders = knex('orders as o')
    .leftJoin('customers as cu', 'cu.id', 'o.customer_id')
    .leftJoin('counters as c', 'c.id', 'o.counter_id')
    .where('o.store_id', storeId)
    .whereNot('o.status', 'DRAFT')
    .orderBy('o.id', 'desc')
    .limit(8)
    .select(
      'o.document_id as order_id',
      'o.invoice_no',
      'o.provisional_no',
      'o.order_type',
      'o.status',
      'o.total_paise',
      'o.server_created_at',
      'cu.name as customer_name',
      'c.code as counter_code'
    );

  const [dayRows, ret, kh, pay, cust, ctr, shifts, lowItems, lowCount, recent] = await Promise.all([
    salesByDay,
    returnsToday,
    khata,
    payables,
    activeCustomers,
    counters,
    liveShifts,
    lowStockItems,
    lowStockCount,
    recentOrders,
  ]);

  const byDay = new Map<string, { sales_paise: number; bills: number }>();
  for (const r of dayRows as Array<Record<string, unknown>>) {
    byDay.set(isoDay(r.business_date), { sales_paise: num(r.sales_paise), bills: num(r.bills) });
  }
  const trend = Array.from({ length: TREND_DAYS }, (_, i) => {
    const date = shiftIsoDay(trendStart, i);
    return { date, ...(byDay.get(date) ?? { sales_paise: 0, bills: 0 }) };
  });

  const toIso = (v: unknown) => (v == null ? null : new Date(v as string | number | Date).toISOString());

  return {
    business_date: today,
    sales: {
      today_paise: byDay.get(today)?.sales_paise ?? 0,
      yesterday_paise: byDay.get(yesterday)?.sales_paise ?? 0,
      bills_today: byDay.get(today)?.bills ?? 0,
      bills_yesterday: byDay.get(yesterday)?.bills ?? 0,
      returns_today_paise: num(ret?.returns_paise),
      trend,
    },
    khata: { outstanding_paise: num(kh?.outstanding_paise), customers_with_dues: num(kh?.n) },
    payables: { outstanding_paise: num(pay?.outstanding_paise), suppliers_with_dues: num(pay?.n) },
    customers: { active: num(cust?.n) },
    counters: { active: num(ctr?.active), total: num(ctr?.total) },
    shifts: {
      live: (shifts as Array<Record<string, unknown>>).map((s) => ({
        counter_code: (s.counter_code as string) ?? null,
        counter_name: (s.counter_name as string) ?? null,
        cashier_name: (s.cashier_name as string) ?? null,
        status: String(s.status),
        opened_at: toIso(s.opened_at),
        bill_count: num(s.bill_count),
      })),
    },
    low_stock: {
      count: num(lowCount?.n),
      items: (lowItems as Array<Record<string, unknown>>).map((p) => ({
        product_id: String(p.product_id),
        name: String(p.name),
        base_unit: (p.base_unit as string) ?? null,
        stock_base: num(p.stock_base),
        reorder_level_base: num(p.reorder_level_base),
      })),
    },
    recent_orders: (recent as Array<Record<string, unknown>>).map((o) => ({
      order_id: String(o.order_id),
      invoice_no: (o.invoice_no as string) ?? null,
      provisional_no: (o.provisional_no as string) ?? null,
      order_type: String(o.order_type),
      status: String(o.status),
      total_paise: num(o.total_paise),
      customer_name: (o.customer_name as string) ?? null,
      counter_code: (o.counter_code as string) ?? null,
      created_at: toIso(o.server_created_at),
    })),
  };
}
