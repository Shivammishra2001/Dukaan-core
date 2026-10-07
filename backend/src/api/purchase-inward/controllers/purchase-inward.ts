import type { Core } from '@strapi/strapi';
import type { ExtendableContext } from 'koa';
import { AppError } from '../../../services/errors';
import { createPurchaseInward } from '../services/purchase-inward';

/** Mirrors checkout/controllers/checkout.ts exactly: no business logic here (Rule BE-1). */
export default ({ strapi }: { strapi: Core.Strapi }) => ({
  async create(ctx: ExtendableContext) {
    const traceId = (ctx.request.header['x-trace-id'] as string) ?? crypto.randomUUID();
    const idempotencyKey = ctx.request.header['idempotency-key'] as string | undefined;
    const storeDocumentId = ctx.request.header['x-store-id'] as string | undefined;

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
      const { response, httpStatus, replay } = await createPurchaseInward(ctx.request.body, { storeDocumentId, idempotencyKey });
      ctx.status = httpStatus;
      if (replay) ctx.set('Idempotent-Replay', 'true');
      ctx.set('X-Server-Time', new Date().toISOString());
      ctx.body = { data: response };
    } catch (err) {
      if (err instanceof AppError) {
        ctx.status = err.status;
        ctx.body = { error: { code: err.code, message: err.message, details: err.details, resolutions: err.resolutions, trace_id: traceId } };
        return;
      }
      strapi.log.error('purchase-inward.create failed', err as Error);
      ctx.status = 500;
      ctx.body = { error: { code: 'ERR_INTERNAL', message: 'Unexpected error', trace_id: traceId } };
    }
  },
});
