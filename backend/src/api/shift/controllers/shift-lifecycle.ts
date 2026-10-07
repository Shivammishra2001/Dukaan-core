import type { Core } from '@strapi/strapi';
import type { ExtendableContext } from 'koa';
import { AppError } from '../../../services/errors';
import {
  closeShift,
  forceCloseShift,
  getActiveShift,
  getExpectedCash,
  openShift,
  recordCashMovement,
  type DenominationCount,
} from '../services/shift-lifecycle';

/**
 * Strapi's router injects `ctx.params` at runtime (via @koa/router, which
 * has no `@types` package here) — plain `koa`'s `ExtendableContext` doesn't
 * declare it, so this extends it locally rather than typing every handler `any`.
 */
type RouteContext = ExtendableContext & { params: Record<string, string> };

/** API_CONTRACTS.md §6. Rule BE-1: no business logic here — just header/body mapping and error translation (mirrors checkout's controller). */
export default ({ strapi }: { strapi: Core.Strapi }) => ({
  async open(ctx: ExtendableContext) {
    const traceId = (ctx.request.header['x-trace-id'] as string) ?? crypto.randomUUID();
    const storeDocumentId = ctx.request.header['x-store-id'] as string | undefined;
    const cashierDocumentId = ctx.request.header['x-cashier-id'] as string | undefined;
    if (!storeDocumentId) return badRequest(ctx, 'X-Store-Id header is required', traceId);

    const body = ctx.request.body as { counter_id: string; opening_float_paise: number };

    try {
      const { shift, counter, cashier } = await openShift({
        storeDocumentId,
        counterDocumentId: body.counter_id,
        cashierDocumentId,
        openingFloatPaise: body.opening_float_paise,
      });
      ctx.status = 201;
      ctx.body = { data: toShiftSummary(shift, counter, cashier) };
    } catch (err) {
      handleError(ctx, err, traceId, strapi);
    }
  },

  /** The signed-in cashier's OPEN shift in this store (or null) — lets the POS resume it after a reload. */
  async active(ctx: ExtendableContext) {
    const traceId = (ctx.request.header['x-trace-id'] as string) ?? crypto.randomUUID();
    const storeDocumentId = ctx.request.header['x-store-id'] as string | undefined;
    const cashierDocumentId = ctx.request.header['x-cashier-id'] as string | undefined;
    if (!storeDocumentId) return badRequest(ctx, 'X-Store-Id header is required', traceId);

    try {
      const found = await getActiveShift(storeDocumentId, cashierDocumentId);
      ctx.status = 200;
      ctx.body = { data: found ? toShiftSummary(found.shift, found.counter, found.cashier) : null };
    } catch (err) {
      handleError(ctx, err, traceId, strapi);
    }
  },

  async expected(ctx: RouteContext) {
    const traceId = (ctx.request.header['x-trace-id'] as string) ?? crypto.randomUUID();
    const storeDocumentId = ctx.request.header['x-store-id'] as string | undefined;
    if (!storeDocumentId) return badRequest(ctx, 'X-Store-Id header is required', traceId);

    try {
      const { shift, expected } = await getExpectedCash(storeDocumentId, ctx.params.id);
      ctx.status = 200;
      ctx.body = {
        data: {
          shift_id: shift.document_id,
          opening_float_paise: Number(shift.opening_float_paise),
          cash_sales_paise: Number(shift.cash_sales_paise),
          cash_collections_paise: Number(shift.cash_collections_paise),
          cash_in_paise: Number(shift.cash_in_paise),
          cash_out_paise: Number(shift.cash_out_paise),
          cash_refunds_paise: Number(shift.cash_refunds_paise),
          expected_cash_paise: expected,
          non_cash: {
            card_paise: Number(shift.card_sales_paise),
            upi_paise: Number(shift.upi_sales_paise),
            wallet_paise: Number(shift.wallet_sales_paise),
            credit_paise: Number(shift.credit_sales_paise),
          },
          // Rule SH-4 blockers (unsynced bills / parked carts) require client-reported
          // outbox depth, which this server has no visibility into — see shift-lifecycle.ts.
          blockers: [],
        },
      };
    } catch (err) {
      handleError(ctx, err, traceId, strapi);
    }
  },

  async close(ctx: RouteContext) {
    const traceId = (ctx.request.header['x-trace-id'] as string) ?? crypto.randomUUID();
    const storeDocumentId = ctx.request.header['x-store-id'] as string | undefined;
    const cashierDocumentId = ctx.request.header['x-cashier-id'] as string | undefined;
    if (!storeDocumentId) return badRequest(ctx, 'X-Store-Id header is required', traceId);

    const body = ctx.request.body as {
      denomination_count: DenominationCount;
      variance_reason_code?: string;
      variance_reason_text?: string;
      approval_token?: string;
      has_pending_offline_sync?: boolean;
    };

    try {
      const result = await closeShift({
        storeDocumentId,
        shiftDocumentId: ctx.params.id,
        denominationCount: body.denomination_count,
        varianceReasonCode: body.variance_reason_code,
        varianceReasonText: body.variance_reason_text,
        hasApproval: Boolean(body.approval_token),
        closedByDocumentId: cashierDocumentId,
        approverDocumentId: cashierDocumentId,
        hasPendingOfflineSync: body.has_pending_offline_sync,
      });
      ctx.status = 200;
      ctx.body = { data: buildCloseShiftResponse(result) };
    } catch (err) {
      handleError(ctx, err, traceId, strapi);
    }
  },

  async cashMovement(ctx: RouteContext) {
    const traceId = (ctx.request.header['x-trace-id'] as string) ?? crypto.randomUUID();
    const storeDocumentId = ctx.request.header['x-store-id'] as string | undefined;
    const cashierDocumentId = ctx.request.header['x-cashier-id'] as string | undefined;
    if (!storeDocumentId) return badRequest(ctx, 'X-Store-Id header is required', traceId);

    const body = ctx.request.body as { direction: 'IN' | 'OUT'; amount_paise: number; reason_code: string; note?: string };

    try {
      const shift = await recordCashMovement({
        storeDocumentId,
        shiftDocumentId: ctx.params.id,
        direction: body.direction,
        amountPaise: body.amount_paise,
        reasonCode: body.reason_code,
        note: body.note,
        createdByDocumentId: cashierDocumentId,
      });
      ctx.status = 201;
      ctx.body = { data: { shift_id: shift.document_id, cash_in_paise: Number(shift.cash_in_paise), cash_out_paise: Number(shift.cash_out_paise) } };
    } catch (err) {
      handleError(ctx, err, traceId, strapi);
    }
  },

  async forceClose(ctx: RouteContext) {
    const traceId = (ctx.request.header['x-trace-id'] as string) ?? crypto.randomUUID();
    const storeDocumentId = ctx.request.header['x-store-id'] as string | undefined;
    const cashierDocumentId = ctx.request.header['x-cashier-id'] as string | undefined;
    if (!storeDocumentId) return badRequest(ctx, 'X-Store-Id header is required', traceId);

    const body = ctx.request.body as { approval_token?: string; reason_text: string };
    if (!body.approval_token) return badRequest(ctx, 'approval_token is required to force-close a shift', traceId);

    try {
      const shift = await forceCloseShift({
        storeDocumentId,
        shiftDocumentId: ctx.params.id,
        reasonText: body.reason_text,
        approverDocumentId: cashierDocumentId,
      });
      ctx.status = 200;
      ctx.body = { data: { id: shift.document_id, status: shift.status, force_closed: true } };
    } catch (err) {
      handleError(ctx, err, traceId, strapi);
    }
  },
});

function toShiftSummary(shift: Record<string, any>, counter: Record<string, any>, cashier: Record<string, any>) {
  return {
    id: shift.document_id,
    counter: { id: counter.document_id, code: counter.code, name: counter.name },
    user: { id: cashier.document_id, full_name: cashier.full_name },
    status: shift.status,
    opened_at: shift.opened_at,
    closed_at: shift.closed_at ?? undefined,
    opening_float_paise: Number(shift.opening_float_paise),
    bill_count: shift.bill_count,
    tender_totals: {
      CASH: Number(shift.cash_sales_paise),
      CARD: Number(shift.card_sales_paise),
      UPI: Number(shift.upi_sales_paise),
      WALLET: Number(shift.wallet_sales_paise),
      CREDIT: Number(shift.credit_sales_paise),
      BANK_TRANSFER: 0,
      CHEQUE: 0,
    },
  };
}

function buildCloseShiftResponse(result: Awaited<ReturnType<typeof closeShift>>) {
  const { shift, expected, actual, variance, classification, store } = result;
  return {
    shift: {
      id: shift.document_id,
      status: shift.status,
      opened_at: shift.opened_at,
      closed_at: shift.closed_at,
      opening_float_paise: Number(shift.opening_float_paise),
      bill_count: shift.bill_count,
      tender_totals: {
        CASH: Number(shift.cash_sales_paise),
        CARD: Number(shift.card_sales_paise),
        UPI: Number(shift.upi_sales_paise),
        WALLET: Number(shift.wallet_sales_paise),
        CREDIT: Number(shift.credit_sales_paise),
        BANK_TRANSFER: 0,
        CHEQUE: 0,
      },
    },
    expected_cash_paise: expected,
    actual_cash_paise: actual,
    variance_paise: variance,
    variance_classification: classification,
    z_report: {
      shift_id: shift.document_id,
      store_name: store.name,
      counter_code: undefined,
      cashier_name: undefined,
      opened_at: shift.opened_at,
      closed_at: shift.closed_at,
      tender_totals: {
        CASH: Number(shift.cash_sales_paise),
        CARD: Number(shift.card_sales_paise),
        UPI: Number(shift.upi_sales_paise),
        WALLET: Number(shift.wallet_sales_paise),
        CREDIT: Number(shift.credit_sales_paise),
        BANK_TRANSFER: 0,
        CHEQUE: 0,
      },
      bill_count: shift.bill_count,
      avg_bill_paise: shift.bill_count > 0 ? Math.round((Number(shift.cash_sales_paise) + Number(shift.card_sales_paise) + Number(shift.upi_sales_paise) + Number(shift.wallet_sales_paise) + Number(shift.credit_sales_paise)) / shift.bill_count) : 0,
      discount_total_paise: Number(shift.discount_total_paise),
      void_count: shift.void_count,
      return_count: shift.return_count,
      expected_cash_paise: expected,
      actual_cash_paise: actual,
      variance_paise: variance,
    },
    print_payload: {
      template: 'RECEIPT_58',
      language: 'en',
      render_mode: 'TEXT',
      copies: 1,
      mark_provisional: false,
      header: { store_name: store.name, address_lines: [] },
      meta: { invoice_no: `Z-${shift.document_id.slice(0, 8)}`, date_display: new Date().toLocaleDateString('en-IN'), time_display: new Date().toLocaleTimeString('en-IN'), cashier: '' },
      lines: [],
      totals_block: [
        { label: 'Expected Cash', value: (expected / 100).toFixed(2) },
        { label: 'Actual Cash', value: (actual / 100).toFixed(2) },
        { label: 'Variance', value: (variance / 100).toFixed(2), emphasis: true },
      ],
      payments_block: [],
      footer_lines: ['End of shift report'],
      open_drawer: false,
    },
  };
}

function badRequest(ctx: ExtendableContext, message: string, traceId: string) {
  ctx.status = 400;
  ctx.body = { error: { code: 'ERR_VALIDATION', message, trace_id: traceId } };
}

function handleError(ctx: ExtendableContext, err: unknown, traceId: string, strapi: Core.Strapi) {
  if (err instanceof AppError) {
    ctx.status = err.status;
    ctx.body = { error: { code: err.code, message: err.message, details: err.details, resolutions: err.resolutions, trace_id: traceId } };
    return;
  }
  strapi.log.error('shift-lifecycle failed', err as Error);
  ctx.status = 500;
  ctx.body = { error: { code: 'ERR_INTERNAL', message: 'Unexpected error', trace_id: traceId } };
}
