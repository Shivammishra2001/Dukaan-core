import type { Core } from '@strapi/strapi';
import type { ExtendableContext } from 'koa';
import { AppError } from '../../../services/errors';
import { importProducts } from '../services/product-import';

/**
 * `POST /api/product-import` — bulk product upsert for the session store.
 * The BFF (frontend/app/api/inventory/bulk-upload/route.ts) parses the
 * uploaded spreadsheet and sends `{ rows }`; store and user come from the
 * session-derived headers, never the body. Rule BE-1: mapping only.
 */
export default ({ strapi }: { strapi: Core.Strapi }) => ({
  async create(ctx: ExtendableContext) {
    const traceId = (ctx.request.header['x-trace-id'] as string) ?? crypto.randomUUID();
    const storeDocumentId = ctx.request.header['x-store-id'] as string | undefined;
    const userDocumentId = ctx.request.header['x-user-id'] as string | undefined;
    if (!storeDocumentId) {
      ctx.status = 400;
      ctx.body = { error: { code: 'ERR_VALIDATION', message: 'X-Store-Id header is required', trace_id: traceId } };
      return;
    }

    try {
      const body = ctx.request.body as { rows?: unknown } | undefined;
      const summary = await importProducts(body?.rows, { storeDocumentId, userDocumentId, traceId });
      ctx.status = 200;
      ctx.body = { data: summary };
    } catch (err) {
      if (err instanceof AppError) {
        ctx.status = err.status;
        ctx.body = { error: { code: err.code, message: err.message, details: err.details, trace_id: traceId } };
        return;
      }
      strapi.log.error('product-import failed', err as Error);
      ctx.status = 500;
      ctx.body = { error: { code: 'ERR_INTERNAL', message: 'Unexpected error', trace_id: traceId } };
    }
  },
});
