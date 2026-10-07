import fs from 'fs';
import path from 'path';
import type { Core } from '@strapi/strapi';

/**
 * Runs backend/database/post-sync-migrations/*.js once each, in filename order,
 * from bootstrap() — i.e. AFTER Strapi has synced its content-type tables.
 *
 * Why not Strapi's own database/migrations folder: Strapi runs those *before*
 * schema sync (@strapi/database schema.sync: migrations.up() then syncSchema()),
 * so on a fresh database every migration that alters `stores`, `products`, …
 * or references them from a custom table fails — the tables don't exist yet.
 * Early-returning on a missing table isn't an option either: the migration
 * would be recorded as done and its constraints / ledger tables / triggers
 * would never be created.
 *
 * Each migration runs in its own transaction (same as Strapi's runner) and is
 * recorded in `dukaan_migrations`; a failure aborts startup so a half-migrated
 * database never serves traffic.
 */
const TABLE = 'dukaan_migrations';

interface MigrationModule {
  up: (trx: unknown) => Promise<void>;
}

export async function runPostSyncMigrations(strapi: Core.Strapi): Promise<void> {
  const knex = strapi.db.connection;
  const dir = path.join(strapi.dirs.app.root, 'database', 'post-sync-migrations');
  if (!fs.existsSync(dir)) return;

  if (!(await knex.schema.hasTable(TABLE))) {
    await knex.schema.createTable(TABLE, (t) => {
      t.string('name', 255).primary();
      t.timestamp('run_at').notNullable().defaultTo(knex.fn.now());
    });
  }

  const applied = new Set((await knex(TABLE).select('name')).map((r: { name: string }) => r.name));
  // Databases migrated before this runner existed recorded these same files in
  // Strapi's own strapi_migrations table — treat those as already applied.
  if (await knex.schema.hasTable('strapi_migrations')) {
    for (const r of await knex('strapi_migrations').select('name')) applied.add(r.name);
  }
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.js')).sort();

  for (const name of files) {
    if (applied.has(name)) continue;
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const migration: MigrationModule = require(path.join(dir, name));
    strapi.log.info(`[post-sync-migrations] running ${name}`);
    try {
      await knex.transaction(async (trx) => {
        await migration.up(trx);
        await trx(TABLE).insert({ name });
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new Error(`[post-sync-migrations] ${name} failed: ${message}`);
    }
  }
}
