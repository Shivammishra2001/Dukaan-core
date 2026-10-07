import { getDeviceId } from '@/lib/sync/device';
import type { ApiErrorBody } from '@/types/checkout';
import type { CreateProductRequest, ProductRow, UpdateProductRatesRequest } from '@/types/inventory';

/** Back-office page (SYSTEM_ARCHITECTURE.md §2.1) — plain online fetch client, same split as lib/b2b-client.ts / lib/customer-client.ts. */

export type InventoryResult<T> = { ok: true; data: T } | { ok: false; error: string };

interface StrapiBatchRow {
  status: string;
  current_stock_base: number | string;
}

interface StrapiProductRow {
  documentId: string;
  sku: string;
  name: string;
  name_local?: string;
  category?: { documentId: string; name: string } | null;
  base_unit: ProductRow['base_unit'];
  default_sale_unit: string;
  pricing_unit: string;
  mrp_paise: number | string | null;
  sell_rate_paise: number | string;
  wholesale_tier1_rate_paise?: number | string | null;
  wholesale_tier2_rate_paise?: number | string | null;
  last_cost_paise: number | string | null;
  gst_rate: number | string;
  is_service: boolean;
  is_active: boolean;
  batches?: StrapiBatchRow[];
}

function toProductRow(r: StrapiProductRow): ProductRow {
  const activeStock = (r.batches ?? [])
    .filter((b) => b.status === 'ACTIVE')
    .reduce((sum, b) => sum + Number(b.current_stock_base), 0);
  return {
    id: r.documentId,
    sku: r.sku,
    name: r.name,
    name_local: r.name_local,
    category: r.category ? { id: r.category.documentId, name: r.category.name } : null,
    base_unit: r.base_unit,
    default_sale_unit: r.default_sale_unit,
    pricing_unit: r.pricing_unit,
    mrp_paise: r.mrp_paise === null ? null : Number(r.mrp_paise),
    sell_rate_paise: Number(r.sell_rate_paise),
    wholesale_tier1_rate_paise: r.wholesale_tier1_rate_paise == null ? null : Number(r.wholesale_tier1_rate_paise),
    wholesale_tier2_rate_paise: r.wholesale_tier2_rate_paise == null ? null : Number(r.wholesale_tier2_rate_paise),
    last_cost_paise: r.last_cost_paise === null ? null : Number(r.last_cost_paise),
    gst_rate: Number(r.gst_rate),
    is_service: r.is_service,
    is_active: r.is_active,
    current_stock_base: r.is_service ? '0' : String(activeStock),
  };
}

export async function listProducts(query?: string): Promise<InventoryResult<ProductRow[]>> {
  const url = query ? `/api/inventory/products?q=${encodeURIComponent(query)}` : '/api/inventory/products';
  let res: Response;
  try {
    res = await fetch(url, { headers: { 'X-Device-Id': getDeviceId() }, cache: 'no-store' });
  } catch {
    return { ok: false, error: 'ERR_NETWORK' };
  }
  const payload = await res.json().catch(() => null);
  if (!res.ok) {
    const err = (payload as ApiErrorBody | null)?.error;
    return { ok: false, error: err?.code ?? `HTTP_${res.status}` };
  }
  const rows = ((payload as { data: StrapiProductRow[] } | null)?.data ?? []) as StrapiProductRow[];
  return { ok: true, data: rows.map(toProductRow) };
}

async function callBff<T>(path: string, opts: { method: 'POST' | 'PATCH'; body: unknown }): Promise<InventoryResult<T>> {
  let res: Response;
  try {
    res = await fetch(path, {
      method: opts.method,
      headers: { 'Content-Type': 'application/json', 'X-Device-Id': getDeviceId() },
      body: JSON.stringify(opts.body),
    });
  } catch {
    return { ok: false, error: 'ERR_NETWORK' };
  }
  const payload = await res.json().catch(() => null);
  if (!res.ok) {
    const err = (payload as ApiErrorBody | null)?.error;
    return { ok: false, error: err?.code ?? `HTTP_${res.status}` };
  }
  return { ok: true, data: toProductRow((payload as { data: StrapiProductRow }).data) as unknown as T };
}

export function updateProductRates(productId: string, request: UpdateProductRatesRequest): Promise<InventoryResult<ProductRow>> {
  return callBff(`/api/inventory/products/${productId}`, { method: 'PATCH', body: request });
}

export function createProduct(request: CreateProductRequest): Promise<InventoryResult<ProductRow>> {
  return callBff('/api/inventory/products', { method: 'POST', body: request });
}
