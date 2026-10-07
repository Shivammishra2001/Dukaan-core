import jwt from 'jsonwebtoken';
import argon2 from 'argon2';
import type { Core } from '@strapi/strapi';
import type { Knex } from 'knex';
import { AppError } from '../../../services/errors';
import { strapiRowStamps } from '../../../services/strapi-row';
import { onboardStoreCore } from '../../stores-onboard/services/onboard';
import { findActiveShift } from '../../shift/services/shift-lifecycle';
import type { BusinessPreset } from '../../stores-onboard/services/presets';

declare const strapi: Core.Strapi;

const JWT_EXPIRES_IN = '7d';

function jwtSecret(): string {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new AppError('ERR_INTERNAL', 500, 'JWT_SECRET is not configured');
  return secret;
}

export interface AuthTokenPayload {
  userId: string;
  tenantId: string;
  storeId: string;
  role: string;
  preset: BusinessPreset;
}

function signToken(payload: AuthTokenPayload): string {
  return jwt.sign(payload as object, jwtSecret(), { expiresIn: JWT_EXPIRES_IN });
}

function verifyToken(token: string): AuthTokenPayload {
  try {
    return jwt.verify(token, jwtSecret()) as unknown as AuthTokenPayload;
  } catch {
    throw new AppError('ERR_UNAUTHENTICATED', 401, 'Invalid or expired session token');
  }
}

function slugifyCompanyName(name: string): string {
  return name.toUpperCase().replace(/[^A-Z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'TENANT';
}

function parseConfig(config: unknown): Record<string, unknown> {
  return typeof config === 'string' ? JSON.parse(config) : ((config as Record<string, unknown>) ?? {});
}

export interface RegisterCompanyInput {
  company_name: string;
  business_preset: BusinessPreset;
  owner_name: string;
  phone: string;
  password: string;
  city?: string;
  state: string;
}

export interface AuthProfile {
  user: { id: string; full_name: string; phone: string | null };
  tenant: { id: string; name: string; tenant_code: string };
  store: { id: string; code: string; name: string; business_preset: BusinessPreset };
  role: string;
}

/**
 * §2.5's tenant_id-scoped `uq_user_email` constraint is on email, not phone —
 * but registration here only asks for phone, so this uniqueness check (and
 * schema.json's `phone: { unique: true }`) is the actual guard against
 * duplicate sign-ups.
 */
export async function registerCompany(input: RegisterCompanyInput): Promise<{ token: string; profile: AuthProfile }> {
  if (!input?.company_name || !input.business_preset || !input.owner_name || !input.phone || !input.password || !input.state) {
    throw new AppError('ERR_VALIDATION', 400, 'company_name, business_preset, owner_name, phone, password and state are required');
  }
  if (input.password.length < 8) {
    throw new AppError('ERR_VALIDATION', 400, 'password must be at least 8 characters');
  }

  const passwordHash = await argon2.hash(input.password);

  return strapi.db.connection.transaction(async (trx: Knex.Transaction) => {
    const existingPhone = await trx('app_users').where({ phone: input.phone }).first();
    if (existingPhone) {
      throw new AppError('ERR_PHONE_TAKEN', 422, 'An account with this phone number already exists');
    }

    let tenantCode = slugifyCompanyName(input.company_name);
    let suffix = 0;
    for (;;) {
      const taken = await trx('tenants').where({ tenant_code: tenantCode }).first();
      if (!taken) break;
      suffix += 1;
      tenantCode = `${slugifyCompanyName(input.company_name)}-${suffix}`;
    }

    const { store, tenant } = await onboardStoreCore(trx, {
      tenantName: input.company_name,
      preset: input.business_preset,
      store: {
        code: 'S1',
        name: input.company_name,
        state_code: input.state,
        city: input.city,
        phone: input.phone,
      },
    });

    await trx('tenants').where({ id: tenant.id }).update({ tenant_code: tenantCode });

    const role = await trx('roles').where({ code: 'OWNER', is_system: true }).first();
    if (!role) {
      throw new AppError('ERR_INTERNAL', 500, 'OWNER system role is not seeded — restart the backend so bootstrap seeding runs');
    }

    const [appUser] = await trx('app_users')
      .insert({
        ...strapiRowStamps(),
        tenant_id: tenant.id,
        full_name: input.owner_name,
        phone: input.phone,
        password_hash: passwordHash,
        is_active: true,
      })
      .returning('*');

    await trx('app_user_store_roles').insert({
      ...strapiRowStamps(),
      user_id: appUser.id,
      store_id: store.id,
      role_id: role.id,
      is_active: true,
    });

    const token = signToken({
      userId: appUser.document_id,
      tenantId: tenant.document_id,
      storeId: store.document_id,
      role: role.code,
      preset: store.business_preset,
    });

    return {
      token,
      profile: {
        user: { id: appUser.document_id, full_name: appUser.full_name, phone: appUser.phone },
        tenant: { id: tenant.document_id, name: tenant.name, tenant_code: tenantCode },
        store: { id: store.document_id, code: store.code, name: store.name, business_preset: store.business_preset },
        role: role.code,
      },
    };
  });
}

/**
 * `identifier` resolves against phone first, then falls back to tenant_code
 * (the login form's "Store Code" field) mapped to that tenant's OWNER — a
 * tenant_code can't resolve to an arbitrary user since it isn't 1:1 with an
 * app_user, so it deliberately only ever reaches the owner account.
 */
export async function login(identifier: string, password: string): Promise<{ token: string; profile: AuthProfile }> {
  if (!identifier || !password) {
    throw new AppError('ERR_VALIDATION', 400, 'identifier and password are required');
  }
  const knex = strapi.db.connection;

  let appUser = await knex('app_users').where({ phone: identifier }).first();
  if (!appUser) {
    const tenant = await knex('tenants').where({ tenant_code: identifier.toUpperCase() }).first();
    if (tenant) {
      appUser = await knex('app_user_store_roles')
        .join('roles', 'roles.id', 'app_user_store_roles.role_id')
        .join('app_users', 'app_users.id', 'app_user_store_roles.user_id')
        .where({ 'app_users.tenant_id': tenant.id, 'roles.code': 'OWNER', 'app_user_store_roles.is_active': true })
        .select('app_users.*')
        .first();
    }
  }

  if (!appUser || !appUser.password_hash) {
    throw new AppError('ERR_INVALID_CREDENTIALS', 401, 'Invalid phone/store code or password');
  }
  if (!appUser.is_active) {
    throw new AppError('ERR_ACCOUNT_INACTIVE', 403, 'This account has been deactivated');
  }

  const valid = await argon2.verify(appUser.password_hash, password);
  if (!valid) {
    throw new AppError('ERR_INVALID_CREDENTIALS', 401, 'Invalid phone/store code or password');
  }

  const tenant = await knex('tenants').where({ id: appUser.tenant_id }).first();
  const storeRole = await knex('app_user_store_roles')
    .where({ user_id: appUser.id, is_active: true })
    .orderBy('id', 'asc')
    .first();
  if (!storeRole) {
    throw new AppError('ERR_NO_STORE_ACCESS', 403, 'This user has no active store access');
  }
  const store = await knex('stores').where({ id: storeRole.store_id }).first();
  const role = await knex('roles').where({ id: storeRole.role_id }).first();

  await knex('app_users').where({ id: appUser.id }).update({ last_login_at: new Date() });

  const token = signToken({
    userId: appUser.document_id,
    tenantId: tenant.document_id,
    storeId: store.document_id,
    role: role.code,
    preset: store.business_preset,
  });

  return {
    token,
    profile: {
      user: { id: appUser.document_id, full_name: appUser.full_name, phone: appUser.phone },
      tenant: { id: tenant.document_id, name: tenant.name, tenant_code: tenant.tenant_code },
      store: { id: store.document_id, code: store.code, name: store.name, business_preset: store.business_preset },
      role: role.code,
    },
  };
}

/**
 * Shared-terminal cashier login (PRD.md TEN-004): store_code + a short PIN,
 * no phone/password. Since a PIN isn't unique across a store's cashiers on
 * its own, this scans that store's active app_users for whichever one's
 * pin_hash matches — fine at real-world cashier-per-store counts. There's no
 * "set PIN" surface yet (see app-user schema.json's pin_hash description),
 * so this will 401 for every account until a follow-up milestone adds one.
 */
export async function pinLogin(storeCode: string, pin: string): Promise<{ token: string; profile: AuthProfile }> {
  if (!storeCode || !/^\d{4,6}$/.test(pin)) {
    throw new AppError('ERR_VALIDATION', 400, 'store code and a 4-6 digit PIN are required');
  }
  const knex = strapi.db.connection;

  const tenant = await knex('tenants').where({ tenant_code: storeCode.toUpperCase() }).first();
  if (!tenant) {
    throw new AppError('ERR_INVALID_CREDENTIALS', 401, 'Invalid store code or PIN');
  }

  const candidates = await knex('app_user_store_roles')
    .join('roles', 'roles.id', 'app_user_store_roles.role_id')
    .join('app_users', 'app_users.id', 'app_user_store_roles.user_id')
    .join('stores', 'stores.id', 'app_user_store_roles.store_id')
    .where({ 'app_users.tenant_id': tenant.id, 'app_user_store_roles.is_active': true, 'app_users.is_active': true })
    .whereNotNull('app_users.pin_hash')
    .select('app_users.*', 'roles.code as role_code', 'stores.document_id as store_document_id', 'stores.code as store_code', 'stores.name as store_name', 'stores.business_preset as store_preset', 'stores.id as store_row_id');

  let matched: (typeof candidates)[number] | null = null;
  for (const candidate of candidates) {
    if (await argon2.verify(candidate.pin_hash, pin)) {
      matched = candidate;
      break;
    }
  }
  if (!matched) {
    throw new AppError('ERR_INVALID_CREDENTIALS', 401, 'Invalid store code or PIN');
  }

  await knex('app_users').where({ id: matched.id }).update({ last_login_at: new Date() });

  const token = signToken({
    userId: matched.document_id,
    tenantId: tenant.document_id,
    storeId: matched.store_document_id,
    role: matched.role_code,
    preset: matched.store_preset,
  });

  return {
    token,
    profile: {
      user: { id: matched.document_id, full_name: matched.full_name, phone: matched.phone },
      tenant: { id: tenant.document_id, name: tenant.name, tenant_code: tenant.tenant_code },
      store: { id: matched.store_document_id, code: matched.store_code, name: matched.store_name, business_preset: matched.store_preset },
      role: matched.role_code,
    },
  };
}

export interface MeResponse {
  user: { id: string; full_name: string; phone: string | null };
  tenant_id: string;
  role: string;
  store: {
    id: string;
    code: string;
    name: string;
    business_preset: BusinessPreset;
    default_mode: string;
    config: Record<string, unknown>;
  };
  active_shift: { id: string; status: string; opened_at: string } | null;
}

/** GET /api/auth/me. Custom bearer-token check — App User is not a Strapi users-permissions user, so the built-in JWT policy doesn't apply here. */
export async function getMe(token: string): Promise<MeResponse> {
  const payload = verifyToken(token);
  const knex = strapi.db.connection;

  const appUser = await knex('app_users').where({ document_id: payload.userId }).first();
  if (!appUser || !appUser.is_active) {
    throw new AppError('ERR_UNAUTHENTICATED', 401, 'Session is no longer valid');
  }
  const store = await knex('stores').where({ document_id: payload.storeId }).first();
  if (!store) {
    throw new AppError('ERR_NOT_FOUND', 404, 'Store not found');
  }

  const activeShift = await findActiveShift(knex, store, appUser.document_id);

  return {
    user: { id: appUser.document_id, full_name: appUser.full_name, phone: appUser.phone },
    tenant_id: payload.tenantId,
    role: payload.role,
    store: {
      id: store.document_id,
      code: store.code,
      name: store.name,
      business_preset: store.business_preset,
      default_mode: store.default_mode,
      config: parseConfig(store.config),
    },
    active_shift: activeShift ? { id: activeShift.document_id, status: activeShift.status, opened_at: activeShift.opened_at } : null,
  };
}
