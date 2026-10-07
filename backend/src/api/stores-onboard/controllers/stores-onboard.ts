import type { Core } from '@strapi/strapi';
import type { ExtendableContext } from 'koa';
import { AppError } from '../../../services/errors';
import { onboardStore, type OnboardStoreInput } from '../services/onboard';

export default ({ strapi }: { strapi: Core.Strapi }) => ({
  async onboard(ctx: ExtendableContext) {
    const traceId = (ctx.request.header['x-trace-id'] as string) ?? crypto.randomUUID();
    const body = ctx.request.body as OnboardStoreInput;

    try {
      const { store, tenant, counter, seededProducts, seededConversions } = await onboardStore(body);
      ctx.status = 201;
      ctx.body = {
        data: {
          tenant: { id: tenant.document_id, name: tenant.name },
          store: {
            id: store.document_id,
            code: store.code,
            name: store.name,
            default_mode: store.default_mode,
            business_preset: store.business_preset,
            config: typeof store.config === 'string' ? JSON.parse(store.config) : store.config,
          },
          counter: { id: counter.document_id, code: counter.code, name: counter.name },
          seeded: { products: seededProducts, unit_conversions: seededConversions },
        },
      };
    } catch (err) {
      if (err instanceof AppError) {
        ctx.status = err.status;
        ctx.body = { error: { code: err.code, message: err.message, details: err.details, trace_id: traceId } };
        return;
      }
      strapi.log.error('stores-onboard.onboard failed', err as Error);
      ctx.status = 500;
      ctx.body = { error: { code: 'ERR_INTERNAL', message: 'Unexpected error', trace_id: traceId } };
    }
  },
});
