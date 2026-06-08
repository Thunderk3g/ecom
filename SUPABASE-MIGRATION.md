# Supabase + Vercel migration runbook

Moving the platform off self-hosted Postgres/Redis/Render onto **Supabase** (database, storage, auth, jobs) with the **Next.js UI on Vercel**. The application *logic* (cart, checkout, inventory reservations, order lifecycle, RLS tenancy) does not change — this is an infrastructure migration.

> **Why Supabase, not Firebase:** Supabase *is* managed Postgres with Row-Level Security, which is exactly this app's data model. Firebase is Firestore (NoSQL) — no SQL/joins/transactions/RLS/Drizzle — and would require rewriting the entire data layer. Supabase is a config-and-provisioning migration; Firebase would be a rebuild.

## Status

| Phase | Scope | State |
|---|---|---|
| 0 | Unblock dev server (Sentry disabled, CSP dev fix) | ✅ done |
| 1 | DB connection Supabase-ready (`APP_DATABASE_URL`, runtime role decoupled) | ✅ done — code in place |
| 2 | Provision Supabase project + run migrations + seed | ✅ done 2026-06-08 — 56 tables, seeded, RLS verified |
| 3 | Storage: R2 → Supabase Storage (behind existing MediaProvider) | ⏳ planned |
| 4 | Jobs: BullMQ/Redis → Supabase (pg_cron + Postgres queue + Edge Functions) | ⏳ planned (largest rewrite) |
| 5 | Deploy UI → Vercel (env wiring, build) | ⏳ planned |

---

## Phase 1 — what changed in code (done)

- `src/lib/env.ts`: added optional **`APP_DATABASE_URL`** — the explicit NOBYPASSRLS runtime connection string.
- `src/db/client.ts`: `resolveAppUrl()` now prefers `APP_DATABASE_URL`; falls back to deriving `app_user` from the local `app_migrator` URL. **Local Docker dev is unchanged** (leave `APP_DATABASE_URL` unset).
- `supabase/bootstrap.sql`: provisions the `app_user` runtime role + grants on a Supabase project.
- Sentry made opt-in/out-of-bundle (`src/lib/sentry.ts`), so the server no longer 500s without observability infra.

## Phase 2 — stand up the database (do this when you have a Supabase project)

1. Create a Supabase project; grab the connection strings (Project → Settings → Database):
   - **Direct** (port 5432) — use for migrations/seed.
   - **Transaction pooler** (port 6543) — use for the app runtime (works with `SET LOCAL` per-transaction; `prepare:false` is already set).
2. In the Supabase **SQL Editor**, run `supabase/bootstrap.sql` once. Replace the `app_user` password placeholder with a real secret.
3. Set env (locally in `.env` to test against Supabase, and later in Vercel):
   ```
   DATABASE_URL=postgresql://postgres:<pw>@<host>:5432/postgres          # migrator (direct)
   APP_DATABASE_URL=postgresql://app_user:<secret>@<host>:6543/postgres   # runtime (pooler)
   ```
4. Apply schema + seed:
   ```
   pnpm db:migrate
   pnpm db:seed
   ```
5. Verify: storefront/admin render against Supabase exactly as they do locally.

### Phase 2 — what actually happened (2026-06-08)

Run from an unblocked network (corporate egress blocks Postgres ports 5432/6543; only :443 is open). Project `hasuznrxkgybphouxjoj`, region `aws-1-ap-southeast-1`, **free tier** (direct host is IPv6-only → everything goes through the Supavisor pooler).

1. **Connection strings** (pooler; custom roles use the tenant-qualified `<role>.<ref>` username):
   - migrate/seed → session pooler **`:5432`** as `postgres.<ref>` (advisory locks need session mode).
   - runtime → transaction pooler **`:6543`** as `app_user.<ref>` (`prepare:false` already set in `src/db/client.ts`).
2. **`bootstrap.sql` now provisions BOTH roles** (it previously only made `app_user`):
   - `app_migrator` NOLOGIN BYPASSRLS, `GRANT app_migrator TO postgres`, plus `USAGE, CREATE ON SCHEMA public` and `ALL` on tables/sequences (+ default privileges). Needed because migration `0010` does `ALTER FUNCTION … OWNER TO app_migrator` on the SECURITY DEFINER stock/threshold trigger functions — that role must exist, `postgres` must be a member, and the new owner needs `CREATE` on `public` for the ownership transfer. Supabase `postgres` has `BYPASSRLS`+`CREATEROLE` so it can create it.
   - `app_user` LOGIN NOBYPASSRLS (runtime), unchanged.
3. Applied 23 Drizzle migrations + seed (11 products / 14 variants). `pg_trgm`/`unaccent` (migration 0007) created fine on Supabase.
4. **RLS verified** as `app_user`: 0 rows without `app.store_id`, 11 with it set.

> Local dev was untouched — migrate/seed ran with **inline env overrides**, `.env` still points at local Docker (`DATABASE_URL`/`APP_DATABASE_URL` unset there; Supabase strings stashed as inert `SUPABASE_*` vars).
>
> **Open follow-up (security hygiene):** run `get_advisors` / `supabase db advisors`. The SECURITY DEFINER functions live in `public`; they're `RETURNS trigger` (PostgREST won't expose them as RPC) and no tables are granted to `anon`/`authenticated`, so the Data API can't reach tenant data — but an advisors pass before Vercel cutover is worth it.

## Phase 3 — storage (R2 → Supabase Storage)

The media layer is already behind a `MediaProvider` abstraction (`MEDIA_PROVIDER` env). Add a `supabase-storage` provider implementing the same interface (signed upload URL + public/derivative URL), then flip `MEDIA_PROVIDER`. No call-site changes.

## Phase 4 — background jobs (BullMQ/Redis → Supabase) — largest piece

Current async work (BullMQ queues + worker + scheduler): `emails`, `csv.imports`, `inventory.alerts`, `search.reindex`, `webhook.dispatch`, `image.post-process`, `reservation.ttl.sweep`, daily reports, sitemap regen.

Target on Supabase:
- **Queue** → a Postgres-backed job table (or `pgmq`) instead of Redis/BullMQ.
- **Scheduler** → **pg_cron** for the periodic enqueuers (TTL sweeps, daily reports, sitemap).
- **Workers** → **Supabase Edge Functions** triggered by cron / DB webhooks / queue polling.

This removes Redis entirely (then `REDIS_URL` becomes optional and the `worker`/`scheduler` Docker roles are retired). It is a real rewrite per job type, so it gets its own plan before implementation.

## Phase 5 — deploy UI to Vercel

- Import the repo into Vercel; framework auto-detected (Next.js).
- Set env: `DATABASE_URL`, `APP_DATABASE_URL`, `SESSION_SECRET`, `COOKIE_DOMAIN`, payment + media keys, `NODE_ENV=production`.
- No `ROLE=worker/scheduler` on Vercel — those become Supabase-side (Phase 4).
- Custom domains map to tenants via the existing host-header tenant resolution (`store_domains`).

---

## Open decisions before Phase 4

- Keep a tiny worker host as an interim while Phase 4 lands, or block deploy on the full jobs rewrite? (Current direction: move jobs to Supabase — Phase 4 — but Phases 2/3/5 can ship first with jobs temporarily disabled or on a stopgap host.)
