import type { Core } from '@strapi/strapi';

/**
 * Gate for the custom BFF-only routes (checkout, shift lifecycle, purchase
 * inward, B2B dispatch, product import). Their controllers trust the
 * X-Store-Id / X-Cashier-Id headers, which the Next.js BFF derives from the
 * verified `dukaan_session` cookie — so the only caller allowed is the BFF,
 * identified by its full-access Strapi API token (STRAPI_SERVICE_TOKEN).
 *
 * Strapi's route auth has already validated the bearer token by the time this
 * runs; this policy additionally rejects users-permissions JWTs and
 * read-only/custom tokens, so granting a role permission in the admin panel
 * can never open these routes up to end users.
 */
interface AuthState {
  strategy?: { name?: string };
  credentials?: { type?: string };
}

const requireServiceToken: Core.PolicyHandler = (policyContext) => {
  // Koa's ctx.state is present at runtime but missing from Strapi's PolicyContext typings.
  const auth = (policyContext as unknown as { state?: { auth?: AuthState } }).state?.auth;
  return auth?.strategy?.name === 'content-api-token' && auth?.credentials?.type === 'full-access';
};

export default requireServiceToken;
