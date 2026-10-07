import type { Core } from '@strapi/strapi';
import type { ExtendableContext } from 'koa';
import { AppError } from '../../../services/errors';
import { registerCompany, login, pinLogin, getMe, type RegisterCompanyInput } from '../services/auth';

function handleError(ctx: ExtendableContext, strapi: Core.Strapi, err: unknown) {
  if (err instanceof AppError) {
    ctx.status = err.status;
    ctx.body = { error: { code: err.code, message: err.message, details: err.details } };
    return;
  }
  strapi.log.error('auth controller failed', err as Error);
  ctx.status = 500;
  ctx.body = { error: { code: 'ERR_INTERNAL', message: 'Unexpected error' } };
}

export default ({ strapi }: { strapi: Core.Strapi }) => ({
  async registerCompany(ctx: ExtendableContext) {
    try {
      const { token, profile } = await registerCompany(ctx.request.body as RegisterCompanyInput);
      ctx.status = 201;
      ctx.body = { data: { token, ...profile } };
    } catch (err) {
      handleError(ctx, strapi, err);
    }
  },

  async login(ctx: ExtendableContext) {
    try {
      const body = ctx.request.body as { identifier: string; password: string };
      const { token, profile } = await login(body?.identifier, body?.password);
      ctx.status = 200;
      ctx.body = { data: { token, ...profile } };
    } catch (err) {
      handleError(ctx, strapi, err);
    }
  },

  async pinLogin(ctx: ExtendableContext) {
    try {
      const body = ctx.request.body as { store_code: string; pin: string };
      const { token, profile } = await pinLogin(body?.store_code, body?.pin);
      ctx.status = 200;
      ctx.body = { data: { token, ...profile } };
    } catch (err) {
      handleError(ctx, strapi, err);
    }
  },

  async me(ctx: ExtendableContext) {
    try {
      const authHeader = (ctx.request.header.authorization as string | undefined) ?? '';
      const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
      if (!token) throw new AppError('ERR_UNAUTHENTICATED', 401, 'Missing bearer token');
      const profile = await getMe(token);
      ctx.status = 200;
      ctx.body = { data: profile };
    } catch (err) {
      handleError(ctx, strapi, err);
    }
  },
});
