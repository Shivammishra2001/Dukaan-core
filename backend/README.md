# DUKAAN Core — Strapi v5 backend

Milestone 1 (schema layer) scope: `Store`, `Product`, `UnitConversion`,
`InventoryBatch`, `Customer` — plus `Tenant` and `Category`, added as minimal
stub content types because `Store`/`Product` have required relations to them
in `DATABASE_SCHEMA.md`. `CustomerLedger` is intentionally **not** a Strapi
content type — per `DATABASE_SCHEMA.md` §9.1 it is a custom, non-admin-editable
table, created by `database/migrations/0008_customer_ledger_entries_table.js`
and served by `src/api/customer/services/ledger.ts`.

## Setup

1. `docker run -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=dukaan -p 5432:5432 postgres:15` (or any Postgres 15+)
2. Copy `.env.example` → `.env` if you don't already have one, and set real
   values for `CUSTOMER_PII_ENC_KEY` / `CUSTOMER_PII_HMAC_KEY` (see the
   generation command in that file) — `src/api/customer/controllers/customer.ts`
   will throw on the first customer write without them.
3. `npm install`
4. `npm run develop` — on first boot this creates every table from
   `src/api/*/content-types/*/schema.json`, then runs
   `database/migrations/*.js` (CHECK constraints, composite unique
   constraints, exact `NUMERIC` precisions, partial/GIN indexes, the UC-A
   invariant trigger, and the append-only ledger trigger — none of which
   `schema.json` alone can express).

This was verified in-session by booting against a throwaway SQLite database:
every content type's relations resolved and `schema.sync()` completed before
migrations began (confirming migrations run *after* the tables they alter
already exist) — it then failed, as expected, on the first Postgres-only
statement (`CREATE EXTENSION pg_trgm`). The migrations themselves have not
been run against a real Postgres instance in this environment; do that before
treating Sprint 1's `pnpm migrate runs clean on an empty DB` acceptance
criterion as met.

## Explicitly out of scope (see file-level comments for each)

- `product_barcodes`, RLS policies (`DATABASE_SCHEMA.md` §10.6), and
  `app_users`/`roles` (so `customer_ledger_entries.created_by_id` /
  `approved_by_id` have no FK constraint yet).
- Domain services beyond the ledger (pricing engine, FEFO allocation,
  checkout transaction) — those are Sprint 2 per `TASKS_BREAKDOWN.md`.

---

# 🚀 Getting started with Strapi

Strapi comes with a full featured [Command Line Interface](https://docs.strapi.io/dev-docs/cli) (CLI) which lets you scaffold and manage your project in seconds.

### `develop`

Start your Strapi application with autoReload enabled. [Learn more](https://docs.strapi.io/dev-docs/cli#strapi-develop)

```
npm run develop
# or
yarn develop
```

### `start`

Start your Strapi application with autoReload disabled. [Learn more](https://docs.strapi.io/dev-docs/cli#strapi-start)

```
npm run start
# or
yarn start
```

### `build`

Build your admin panel. [Learn more](https://docs.strapi.io/dev-docs/cli#strapi-build)

```
npm run build
# or
yarn build
```

## ⚙️ Deployment

Strapi gives you many possible deployment options for your project including [Strapi Cloud](https://cloud.strapi.io). Browse the [deployment section of the documentation](https://docs.strapi.io/dev-docs/deployment) to find the best solution for your use case.

```
yarn strapi deploy
```

## 📚 Learn more

- [Resource center](https://strapi.io/resource-center) - Strapi resource center.
- [Strapi documentation](https://docs.strapi.io) - Official Strapi documentation.
- [Strapi tutorials](https://strapi.io/tutorials) - List of tutorials made by the core team and the community.
- [Strapi blog](https://strapi.io/blog) - Official Strapi blog containing articles made by the Strapi team and the community.
- [Changelog](https://strapi.io/changelog) - Find out about the Strapi product updates, new features and general improvements.

Feel free to check out the [Strapi GitHub repository](https://github.com/strapi/strapi). Your feedback and contributions are welcome!

## ✨ Community

- [Discord](https://discord.strapi.io) - Come chat with the Strapi community including the core team.
- [Forum](https://forum.strapi.io/) - Place to discuss, ask questions and find answers, show your Strapi project and get feedback or just talk with other Community members.
- [Awesome Strapi](https://github.com/strapi/awesome-strapi) - A curated list of awesome things related to Strapi.

---

<sub>🤫 Psst! [Strapi is hiring](https://strapi.io/careers).</sub>
