import type { Core } from '@strapi/strapi';
import type { ExtendableContext } from 'koa';
import { AppError } from '../../../services/errors';
import { bookB2bOrder, buildLoadingSheet, dispatchB2bOrders, deliverB2bOrder } from '../services/b2b-dispatch';

function handleError(ctx: ExtendableContext, err: unknown, traceId: string, strapi: Core.Strapi) {
  if (err instanceof AppError) {
    ctx.status = err.status;
    ctx.body = { error: { code: err.code, message: err.message, details: err.details, resolutions: err.resolutions, trace_id: traceId } };
    return;
  }
  strapi.log.error('b2b-dispatch failed', err as Error);
  ctx.status = 500;
  ctx.body = { error: { code: 'ERR_INTERNAL', message: 'Unexpected error', trace_id: traceId } };
}

export default ({ strapi }: { strapi: Core.Strapi }) => ({
  /** POST /b2b/orders/book */
  async book(ctx: ExtendableContext) {
    const traceId = (ctx.request.header['x-trace-id'] as string) ?? crypto.randomUUID();
    const idempotencyKey = ctx.request.header['idempotency-key'] as string | undefined;
    const storeDocumentId = ctx.request.header['x-store-id'] as string | undefined;
    if (!idempotencyKey || !storeDocumentId) {
      ctx.status = 400;
      ctx.body = { error: { code: 'ERR_VALIDATION', message: 'Idempotency-Key and X-Store-Id headers are required', trace_id: traceId } };
      return;
    }
    try {
      const result = await bookB2bOrder(ctx.request.body, { storeDocumentId, idempotencyKey });
      ctx.status = 201;
      ctx.body = { data: result };
    } catch (err) {
      handleError(ctx, err, traceId, strapi);
    }
  },

  /** GET /b2b/dispatch/loading-sheet?order_ids=a,b,c */
  async loadingSheet(ctx: ExtendableContext) {
    const traceId = (ctx.request.header['x-trace-id'] as string) ?? crypto.randomUUID();
    const storeDocumentId = ctx.request.header['x-store-id'] as string | undefined;
    if (!storeDocumentId) {
      ctx.status = 400;
      ctx.body = { error: { code: 'ERR_VALIDATION', message: 'X-Store-Id header is required', trace_id: traceId } };
      return;
    }
    const orderIds = String(ctx.query.order_ids ?? '').split(',').filter(Boolean);
    try {
      const sheet = await buildLoadingSheet(storeDocumentId, orderIds);
      ctx.status = 200;
      ctx.body = { data: sheet };
    } catch (err) {
      handleError(ctx, err, traceId, strapi);
    }
  },

  /** POST /b2b/orders/dispatch */
  async dispatch(ctx: ExtendableContext) {
    const traceId = (ctx.request.header['x-trace-id'] as string) ?? crypto.randomUUID();
    const storeDocumentId = ctx.request.header['x-store-id'] as string | undefined;
    if (!storeDocumentId) {
      ctx.status = 400;
      ctx.body = { error: { code: 'ERR_VALIDATION', message: 'X-Store-Id header is required', trace_id: traceId } };
      return;
    }
    try {
      const result = await dispatchB2bOrders(ctx.request.body, storeDocumentId);
      ctx.status = 200;
      ctx.body = { data: result };
    } catch (err) {
      handleError(ctx, err, traceId, strapi);
    }
  },

  /** POST /b2b/orders/deliver */
  async deliver(ctx: ExtendableContext) {
    const traceId = (ctx.request.header['x-trace-id'] as string) ?? crypto.randomUUID();
    const storeDocumentId = ctx.request.header['x-store-id'] as string | undefined;
    if (!storeDocumentId) {
      ctx.status = 400;
      ctx.body = { error: { code: 'ERR_VALIDATION', message: 'X-Store-Id header is required', trace_id: traceId } };
      return;
    }
    try {
      const result = await deliverB2bOrder(ctx.request.body, storeDocumentId);
      ctx.status = 200;
      ctx.body = { data: result };
    } catch (err) {
      handleError(ctx, err, traceId, strapi);
    }
  },
});
