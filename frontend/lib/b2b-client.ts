import { getDeviceId } from '@/lib/sync/device';
import type { ApiErrorBody } from '@/types/checkout';
import type {
  B2bOrderLite,
  BookB2bOrderRequest,
  BookB2bOrderResult,
  DispatchOrdersOptions,
  DispatchResponse,
  LoadingSheetResponse,
  PurchaseInwardRequest,
  PurchaseInwardResponse,
  RecordSupplierPaymentRequest,
  SupplierLedgerEntry,
  SupplierLite,
} from '@/types/b2b';
import type { CreateProductRequest } from '@/types/inventory';
import type { Product, UnitCode } from '@/types/pos';

/**
 * Back-office pages (SYSTEM_ARCHITECTURE.md §2.1: "RSC-first, server-fetched,
 * no offline requirement" — the opposite of the POS route), so this is a
 * plain online fetch client with no Dexie/outbox involved, unlike
 * lib/sync/outbox-sync.ts.
 */

export type B2bResult<T> = { ok: true; data: T } | { ok: false; error: string };

async function callBff<T>(path: string, opts: { method: 'GET' | 'POST'; body?: unknown; idempotencyKey?: string }): Promise<B2bResult<T>> {
  let res: Response;
  try {
    res = await fetch(path, {
      method: opts.method,
      headers: {
        'Content-Type': 'application/json',
        'X-Device-Id': getDeviceId(),
        ...(opts.idempotencyKey ? { 'Idempotency-Key': opts.idempotencyKey } : {}),
      },
      body: opts.body ? JSON.stringify(opts.body) : undefined,
    });
  } catch {
    return { ok: false, error: 'ERR_NETWORK' };
  }
  const payload = await res.json().catch(() => null);
  if (!res.ok) {
    const err = (payload as ApiErrorBody | null)?.error;
    return { ok: false, error: err?.code ?? `HTTP_${res.status}` };
  }
  return { ok: true, data: (payload as { data: T }).data };
}

export function submitPurchaseInward(request: PurchaseInwardRequest): Promise<B2bResult<PurchaseInwardResponse>> {
  return callBff('/api/b2b/purchases/inward', { method: 'POST', body: request, idempotencyKey: request.client_uuid });
}

export function bookB2bOrder(request: BookB2bOrderRequest): Promise<B2bResult<BookB2bOrderResult>> {
  return callBff('/api/b2b/orders/book', { method: 'POST', body: request, idempotencyKey: request.client_uuid });
}

export function dispatchB2bOrders(orderIds: string[], opts: DispatchOrdersOptions = {}): Promise<B2bResult<DispatchResponse>> {
  return callBff('/api/b2b/orders/dispatch', { method: 'POST', body: { order_ids: orderIds, ...opts } });
}

/** POST /api/b2b/suppliers/{id}/payment — "Settle Payment" on the Supplier ledger drill-down. */
export function paySupplier(supplierId: string, request: RecordSupplierPaymentRequest): Promise<B2bResult<Record<string, unknown>>> {
  return callBff(`/api/b2b/suppliers/${supplierId}/payment`, { method: 'POST', body: request });
}

export function deliverB2bOrder(orderId: string): Promise<B2bResult<{ order: Record<string, unknown> }>> {
  return callBff('/api/b2b/orders/deliver', { method: 'POST', body: { order_id: orderId } });
}

export function getLoadingSheet(orderIds: string[]): Promise<B2bResult<LoadingSheetResponse>> {
  return callBff(`/api/b2b/dispatch/loading-sheet?order_ids=${encodeURIComponent(orderIds.join(','))}`, { method: 'GET' });
}

interface StrapiB2bOrderRow {
  documentId: string;
  status: B2bOrderLite['status'];
  route?: string;
  vehicle_no?: string;
  transporter?: string;
  driver_name?: string;
  freight_paise?: number | string;
  freight_terms?: B2bOrderLite['freight_terms'];
  challan_no?: string;
  invoice_no?: string;
  total_paise: number | string;
  booked_at: string;
  business_date: string;
  customer?: { name?: string };
}

/** Strapi v5's core `find` envelope: `{ data: [...], meta: { pagination } }` — rows have attributes flattened directly onto them (no v4-style nested `attributes`). */
export async function listB2bOrders(status?: string): Promise<B2bResult<B2bOrderLite[]>> {
  const url = status ? `/api/b2b/orders?status=${encodeURIComponent(status)}` : '/api/b2b/orders';
  let res: Response;
  try {
    res = await fetch(url, { headers: { 'X-Device-Id': getDeviceId() } });
  } catch {
    return { ok: false, error: 'ERR_NETWORK' };
  }
  const payload = await res.json().catch(() => null);
  if (!res.ok) {
    const err = (payload as ApiErrorBody | null)?.error;
    return { ok: false, error: err?.code ?? `HTTP_${res.status}` };
  }
  const rows = ((payload as { data: StrapiB2bOrderRow[] } | null)?.data ?? []) as StrapiB2bOrderRow[];
  return {
    ok: true,
    data: rows.map((r) => ({
      id: r.documentId,
      status: r.status,
      route: r.route,
      vehicle_no: r.vehicle_no,
      transporter: r.transporter,
      driver_name: r.driver_name,
      freight_paise: r.freight_paise == null ? undefined : Number(r.freight_paise),
      freight_terms: r.freight_terms,
      challan_no: r.challan_no,
      invoice_no: r.invoice_no,
      total_paise: Number(r.total_paise),
      booked_at: r.booked_at,
      business_date: r.business_date,
      customer_name: r.customer?.name,
    })),
  };
}

/** Bypasses callBff's generic `{ data }`-only unwrapping — this endpoint's response also carries `meta.current_balance_paise`, which that helper would silently drop. */
export async function getSupplierLedger(supplierId: string): Promise<B2bResult<{ entries: SupplierLedgerEntry[]; current_balance_paise: number }>> {
  let res: Response;
  try {
    res = await fetch(`/api/b2b/suppliers/${supplierId}/ledger`, { headers: { 'X-Device-Id': getDeviceId() } });
  } catch {
    return { ok: false, error: 'ERR_NETWORK' };
  }
  const payload = await res.json().catch(() => null);
  if (!res.ok) {
    const err = (payload as ApiErrorBody | null)?.error;
    return { ok: false, error: err?.code ?? `HTTP_${res.status}` };
  }
  const body = payload as { data: SupplierLedgerEntry[]; meta?: { current_balance_paise?: number } };
  return { ok: true, data: { entries: body.data ?? [], current_balance_paise: body.meta?.current_balance_paise ?? 0 } };
}

// ---------------------------------------------------------------------------
// Real product catalogue for Purchase Inward — replaces lib/b2b-mock-data.ts's
// hardcoded 3-item B2B_PRODUCTS. Reuses the same /api/inventory/products route
// the Saman & Rates page calls (populates batches + unit_conversions), mapped
// into the richer `Product` shape lib/units.ts's findConversion()/toBase() need.
// ---------------------------------------------------------------------------

interface StrapiUnitConversionRow {
  unit_code: UnitCode;
  factor_to_base: number | string;
  is_sale_unit: boolean;
  is_purchase_unit: boolean;
  price_override_paise?: number | string | null;
}

interface StrapiBatchRow {
  status: string;
  current_stock_base: number | string;
}

interface StrapiPurchasableProductRow {
  documentId: string;
  sku: string;
  name: string;
  name_local?: string;
  hsn_code?: string | null;
  category?: { name: string } | null;
  base_unit: Product['base_unit'];
  allow_fractional: boolean;
  quantity_precision: number;
  default_sale_unit: string;
  default_purchase_unit: string;
  pricing_unit: string;
  sell_rate_paise: number | string;
  mrp_paise: number | string | null;
  wholesale_tier1_rate_paise?: number | string | null;
  wholesale_tier2_rate_paise?: number | string | null;
  gst_rate: number | string;
  tax_inclusive: boolean;
  discount_exempt: boolean;
  is_service: boolean;
  unit_conversions?: StrapiUnitConversionRow[];
  batches?: StrapiBatchRow[];
}

function toPurchasableProduct(r: StrapiPurchasableProductRow): Product {
  const stockBase = (r.batches ?? []).filter((b) => b.status === 'ACTIVE').reduce((sum, b) => sum + Number(b.current_stock_base), 0);
  return {
    id: r.documentId,
    sku: r.sku,
    name: r.name,
    name_local: r.name_local,
    category: r.category?.name ?? '',
    base_unit: r.base_unit,
    allow_fractional: r.allow_fractional,
    quantity_precision: Math.min(3, Math.max(0, r.quantity_precision)) as 0 | 1 | 2 | 3,
    default_sale_unit: r.default_sale_unit as UnitCode,
    default_purchase_unit: r.default_purchase_unit as UnitCode,
    pricing_unit: r.pricing_unit as UnitCode,
    sell_rate_paise: Number(r.sell_rate_paise),
    mrp_paise: r.mrp_paise == null ? null : Number(r.mrp_paise),
    wholesale_tier1_rate_paise: r.wholesale_tier1_rate_paise == null ? null : Number(r.wholesale_tier1_rate_paise),
    wholesale_tier2_rate_paise: r.wholesale_tier2_rate_paise == null ? null : Number(r.wholesale_tier2_rate_paise),
    gst_rate: Number(r.gst_rate),
    tax_inclusive: r.tax_inclusive,
    discount_exempt: r.discount_exempt,
    hsn_code: r.hsn_code ?? undefined,
    unit_conversions: (r.unit_conversions ?? []).map((c) => ({
      unit_code: c.unit_code,
      factor_to_base: Number(c.factor_to_base),
      is_sale_unit: c.is_sale_unit,
      is_purchase_unit: c.is_purchase_unit,
      price_override_paise: c.price_override_paise == null ? null : Number(c.price_override_paise),
    })),
    stock_base: stockBase,
    is_loose: !r.is_service && r.allow_fractional,
  };
}

/** GET /api/inventory/products — the store's full active catalogue, for the Purchase Inward product picker (not a hardcoded 3-item list). */
export async function listPurchasableProducts(): Promise<B2bResult<Product[]>> {
  let res: Response;
  try {
    res = await fetch('/api/inventory/products', { headers: { 'X-Device-Id': getDeviceId() }, cache: 'no-store' });
  } catch {
    return { ok: false, error: 'ERR_NETWORK' };
  }
  const payload = await res.json().catch(() => null);
  if (!res.ok) {
    const err = (payload as ApiErrorBody | null)?.error;
    return { ok: false, error: err?.code ?? `HTTP_${res.status}` };
  }
  const rows = ((payload as { data: StrapiPurchasableProductRow[] } | null)?.data ?? []) as StrapiPurchasableProductRow[];
  return { ok: true, data: rows.map(toPurchasableProduct) };
}

/** POST /api/inventory/products — "+ New Product" quick-add from within Purchase Inward. The BFF also creates the required base_unit unit_conversion row (and the purchase-unit one, if requested) so the product is immediately usable in this same form. */
export async function createPurchasableProduct(request: CreateProductRequest): Promise<B2bResult<Product>> {
  let res: Response;
  try {
    res = await fetch('/api/inventory/products', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Device-Id': getDeviceId() },
      body: JSON.stringify(request),
    });
  } catch {
    return { ok: false, error: 'ERR_NETWORK' };
  }
  const payload = await res.json().catch(() => null);
  if (!res.ok) {
    const err = (payload as ApiErrorBody | null)?.error;
    return { ok: false, error: err?.code ?? `HTTP_${res.status}` };
  }
  const row = (payload as { data: StrapiPurchasableProductRow }).data;
  return { ok: true, data: toPurchasableProduct(row) };
}

// ---------------------------------------------------------------------------
// Real supplier directory — replaces lib/b2b-mock-data.ts's MOCK_SUPPLIERS,
// whose fake ids (e.g. "supplier-adani-wilmar") don't belong to any real
// store and always 403 with ERR_STORE_MISMATCH when actually submitted.
// ---------------------------------------------------------------------------

interface StrapiSupplierRow {
  documentId: string;
  name: string;
  phone_last4?: string;
  gstin?: string;
  current_balance_paise: number | string;
}

function toSupplierLite(r: StrapiSupplierRow): SupplierLite {
  return { id: r.documentId, name: r.name, phone_last4: r.phone_last4, gstin: r.gstin, current_balance_paise: Number(r.current_balance_paise) };
}

/** GET /api/b2b/suppliers — the store's real supplier directory. */
export async function listSuppliers(): Promise<B2bResult<SupplierLite[]>> {
  let res: Response;
  try {
    res = await fetch('/api/b2b/suppliers', { headers: { 'X-Device-Id': getDeviceId() }, cache: 'no-store' });
  } catch {
    return { ok: false, error: 'ERR_NETWORK' };
  }
  const payload = await res.json().catch(() => null);
  if (!res.ok) {
    const err = (payload as ApiErrorBody | null)?.error;
    return { ok: false, error: err?.code ?? `HTTP_${res.status}` };
  }
  const rows = ((payload as { data: StrapiSupplierRow[] } | null)?.data ?? []) as StrapiSupplierRow[];
  return { ok: true, data: rows.map(toSupplierLite) };
}

/** POST /api/b2b/suppliers — "+ New" quick-add from Purchase Inward / the Suppliers page. */
export async function createSupplier(request: { name: string; gstin?: string; phone?: string }): Promise<B2bResult<SupplierLite>> {
  let res: Response;
  try {
    res = await fetch('/api/b2b/suppliers', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Device-Id': getDeviceId() },
      body: JSON.stringify(request),
    });
  } catch {
    return { ok: false, error: 'ERR_NETWORK' };
  }
  const payload = await res.json().catch(() => null);
  if (!res.ok) {
    const err = (payload as ApiErrorBody | null)?.error;
    return { ok: false, error: err?.code ?? `HTTP_${res.status}` };
  }
  return { ok: true, data: toSupplierLite((payload as { data: StrapiSupplierRow }).data) };
}
