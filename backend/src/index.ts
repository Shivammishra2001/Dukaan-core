import type { Core } from '@strapi/strapi';
import { strapiRowStamps } from './services/strapi-row';

/**
 * PRD.md TEN-003 / DATABASE_SCHEMA.md §2.5: OWNER, MANAGER, CASHIER,
 * INVENTORY_CLERK, ACCOUNTANT are system roles (tenant = null), seeded once
 * so src/api/auth/services/auth.ts's registerCompany can assign the OWNER
 * role without a chicken-and-egg "create a role during registration" step.
 * `discount_max_pct` per role isn't specified in the docs beyond OWNER
 * (implicitly unrestricted) — left at 0 for the others pending a real
 * permission-catalogue milestone; only role *identity* is used for now.
 */
const SYSTEM_ROLES: Array<{ code: string; name: string; discount_max_pct: number }> = [
  { code: 'OWNER', name: 'Owner', discount_max_pct: 100 },
  { code: 'MANAGER', name: 'Manager', discount_max_pct: 0 },
  { code: 'CASHIER', name: 'Cashier', discount_max_pct: 0 },
  { code: 'INVENTORY_CLERK', name: 'Inventory Clerk', discount_max_pct: 0 },
  { code: 'ACCOUNTANT', name: 'Accountant', discount_max_pct: 0 },
];

async function seedSystemRoles(strapi: Core.Strapi) {
  const knex = strapi.db.connection;
  for (const role of SYSTEM_ROLES) {
    const existing = await knex('roles').where({ code: role.code, is_system: true }).first();
    if (existing) continue;
    await knex('roles').insert({
      ...strapiRowStamps(),
      code: role.code,
      name: role.name,
      is_system: true,
      discount_max_pct: role.discount_max_pct,
    });
    strapi.log.info(`[bootstrap] seeded system role ${role.code}`);
  }
}

export default {
  /**
   * An asynchronous register function that runs before
   * your application is initialized.
   *
   * This gives you an opportunity to extend code.
   */
  register(/* { strapi }: { strapi: Core.Strapi } */) {},

  /**
   * An asynchronous bootstrap function that runs before
   * your application gets started.
   *
   * This gives you an opportunity to set up your data model,
   * run jobs, or perform some special logic.
   */
  async bootstrap({ strapi }: { strapi: Core.Strapi }) {
    await seedSystemRoles(strapi);
  },
};
