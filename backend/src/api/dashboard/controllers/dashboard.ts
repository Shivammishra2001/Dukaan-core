import type { Core } from '@strapi/strapi';
import type { ExtendableContext } from 'koa';
import { AppError } from '../../../services/errors';
import { getDashboardSummary } from '../services/dashboard';

/** Mirrors checkout/controllers/checkout.ts: header mapping + error translation only (Rule BE-1). */
export default ({ strapi }: { strapi: Core.Strapi }) => ({
  async summary(ctx: ExtendableContext) {
    const traceId = (ctx.request.header['x-trace-id'] as string) ?? crypto.randomUUID();
    const storeDocumentId = ctx.request.header['x-store-id'] as string | undefined;

    if (!storeDocumentId) {
      ctx.status = 400;
      ctx.body = { error: { code: 'ERR_VALIDATION', message: 'X-Store-Id header is required', trace_id: traceId } };
      return;
    }

    try {
      const data = await getDashboardSummary(storeDocumentId);
      ctx.set('Cache-Control', 'no-store');
      ctx.set('X-Server-Time', new Date().toISOString());
      ctx.body = { data };
    } catch (err) {
      if (err instanceof AppError) {
        ctx.status = err.status;
        ctx.body = { error: { code: err.code, message: err.message, details: err.details, trace_id: traceId } };
        return;
      }
      strapi.log.error('dashboard.summary failed', err as Error);
      ctx.status = 500;
      ctx.body = { error: { code: 'ERR_INTERNAL', message: 'Unexpected error', trace_id: traceId } };
    }
  },
});
