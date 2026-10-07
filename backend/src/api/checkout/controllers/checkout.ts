import type { Core } from '@strapi/strapi';
import type { ExtendableContext } from 'koa';
import { CheckoutError } from '../../../services/units';
import { createOrder } from '../services/checkout';

/**
 * API_CONTRACTS.md §2 — Strapi-side handler for `POST /api/checkout`
 * (the BFF exposes this as `POST /api/pos/checkout`, see
 * frontend/app/api/pos/checkout/route.ts). Rule BE-1: this controller does
 * no business logic — it only maps headers to context, calls the service,
 * and translates errors to the ApiError envelope (§0.3/§0.4).
 */
export default ({ strapi }: { strapi: Core.Strapi }) => ({
  async create(ctx: ExtendableContext) {
    const traceId = (ctx.request.header['x-trace-id'] as string) ?? crypto.randomUUID();
    const idempotencyKey = ctx.request.header['idempotency-key'] as string | undefined;
    const storeDocumentId = ctx.request.header['x-store-id'] as string | undefined;
    const cashierDocumentId = ctx.request.header['x-cashier-id'] as string | undefined;

    if (!idempotencyKey) {
      ctx.status = 400;
      ctx.body = { error: { code: 'ERR_VALIDATION', message: 'Idempotency-Key header is required', trace_id: traceId } };
      return;
    }
    if (!storeDocumentId) {
      ctx.status = 400;
      ctx.body = { error: { code: 'ERR_VALIDATION', message: 'X-Store-Id header is required', trace_id: traceId } };
      return;
    }

    try {
      const { response, httpStatus, replay } = await createOrder(ctx.request.body, {
        storeDocumentId,
        idempotencyKey,
        cashierDocumentId,
      });
      ctx.status = httpStatus;
      if (replay) ctx.set('Idempotent-Replay', 'true');
      ctx.set('X-Server-Time', new Date().toISOString());
      ctx.body = { data: response };
    } catch (err) {
      if (err instanceof CheckoutError) {
        ctx.status = err.status;
        ctx.body = {
          error: {
            code: err.code,
            message: err.message,
            details: err.details,
            resolutions: err.resolutions,
            trace_id: traceId,
          },
        };
        return;
      }
      strapi.log.error('checkout.create failed', err as Error);
      ctx.status = 500;
      ctx.body = { error: { code: 'ERR_INTERNAL', message: 'Unexpected error', trace_id: traceId } };
    }
  },
});
