import { getDeviceId } from '@/lib/sync/device';
import type { ApiErrorBody } from '@/types/checkout';
import type {
  CashMovementRequest,
  CashMovementResponse,
  CloseShiftRequest,
  CloseShiftResponse,
  ExpectedCashResponse,
  OpenShiftRequest,
  ShiftHistoryRow,
  ShiftSummary,
} from '@/types/shift';

/**
 * REQUIREMENTS.md OFF-002: "shift close... REQUIRE connectivity" — unlike
 * checkout, there is deliberately no offline fallback here; a failed
 * request just surfaces an error for the operator to retry once back online.
 */

export type ShiftResult<T> = { ok: true; data: T } | { ok: false; error: string };

async function callBff<T>(path: string, opts: { method: 'GET' | 'POST'; body?: unknown; idempotencyKey?: string }): Promise<ShiftResult<T>> {
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

export function openShift(counterId: string, openingFloatPaise: number): Promise<ShiftResult<ShiftSummary>> {
  const clientUuid = crypto.randomUUID();
  const body: OpenShiftRequest = { client_uuid: clientUuid, counter_id: counterId, opening_float_paise: openingFloatPaise, device_id: getDeviceId() };
  return callBff('/api/shifts/open', { method: 'POST', body, idempotencyKey: clientUuid });
}

/** The signed-in cashier's OPEN shift in the session store, or null — used to resume it after a reload. */
export function getActiveShift(): Promise<ShiftResult<ShiftSummary | null>> {
  return callBff('/api/pos/shifts/active', { method: 'GET' });
}

export function getExpectedCash(shiftId: string): Promise<ShiftResult<ExpectedCashResponse>> {
  return callBff(`/api/shifts/${shiftId}/expected`, { method: 'GET' });
}

export function closeShift(shiftId: string, request: CloseShiftRequest): Promise<ShiftResult<CloseShiftResponse>> {
  return callBff(`/api/shifts/${shiftId}/close`, { method: 'POST', body: request });
}

export function recordCashMovement(request: CashMovementRequest): Promise<ShiftResult<CashMovementResponse>> {
  return callBff('/api/pos/shifts/cash-movement', { method: 'POST', body: request });
}

interface StrapiShiftRow {
  documentId: string;
  status: ShiftHistoryRow['status'];
  opened_at: string;
  closed_at: string | null;
  opening_float_paise: number | string;
  cash_sales_paise: number | string;
  cash_in_paise: number | string;
  cash_out_paise: number | string;
  actual_cash_paise: number | string | null;
  expected_cash_paise: number | string | null;
  variance_paise: number | string | null;
  bill_count: number;
  counter?: { documentId: string; code: string; name: string } | null;
  cashier?: { documentId: string; full_name: string } | null;
}

/** Strapi v5's core `find` envelope: `{ data: [...], meta: { pagination } }` — used by /reports/shifts (Galla & Shift History), not the lifecycle DTOs above. */
export async function getShiftHistory(): Promise<ShiftResult<ShiftHistoryRow[]>> {
  let res: Response;
  try {
    res = await fetch('/api/reports/shifts', { headers: { 'X-Device-Id': getDeviceId() }, cache: 'no-store' });
  } catch {
    return { ok: false, error: 'ERR_NETWORK' };
  }
  const payload = await res.json().catch(() => null);
  if (!res.ok) {
    const err = (payload as ApiErrorBody | null)?.error;
    return { ok: false, error: err?.code ?? `HTTP_${res.status}` };
  }
  const rows = ((payload as { data: StrapiShiftRow[] } | null)?.data ?? []) as StrapiShiftRow[];
  return {
    ok: true,
    data: rows.map((r) => ({
      id: r.documentId,
      counter: r.counter ? { id: r.counter.documentId, code: r.counter.code, name: r.counter.name } : null,
      cashier: r.cashier ? { id: r.cashier.documentId, full_name: r.cashier.full_name } : null,
      status: r.status,
      opened_at: r.opened_at,
      closed_at: r.closed_at,
      opening_float_paise: Number(r.opening_float_paise),
      cash_sales_paise: Number(r.cash_sales_paise),
      cash_in_paise: Number(r.cash_in_paise),
      cash_out_paise: Number(r.cash_out_paise),
      actual_cash_paise: r.actual_cash_paise == null ? null : Number(r.actual_cash_paise),
      expected_cash_paise: r.expected_cash_paise == null ? null : Number(r.expected_cash_paise),
      variance_paise: r.variance_paise == null ? null : Number(r.variance_paise),
      bill_count: r.bill_count,
    })),
  };
}
