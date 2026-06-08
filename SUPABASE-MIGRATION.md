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
| 4 | Jobs: BullMQ/Redis → Supabase (pg_cron + Postgres queue + Edge Functions) | ⏳ planned (largest rewrite) — interim: stopgap Render worker host |
| 5 | Deploy UI → Vercel (env wiring, build) | 🟡 prep done 2026-06-08 — `vercel.json` + `render.yaml` (jobs host) written, build verified; go-live pending |

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

## Phase 5 — deploy to Vercel + stopgap jobs host

### Final go-live topology

The app is a 3-role Docker app (`web` + `worker` + `scheduler`). Vercel is serverless and runs **only** the `web` role; the two long-lived background roles move to a small Render host (the **stopgap** until Phase 4 retires Redis/BullMQ onto Supabase). Decision made 2026-06-08: stand up the stopgap host so the store is actually correct (otherwise reserved stock never frees and no emails/webhooks fire).

| Component | Host | Connection |
|---|---|---|
| web (SSR / admin / `/api/v1`) | **Vercel** | `vercel.json` (region `sin1`, next to Supabase `ap-southeast-1`) |
| worker + scheduler | **Render** (stopgap) | `render.yaml` (worker+scheduler only; same Docker image, `ROLE` selects entrypoint) |
| Postgres | **Supabase** | session pooler `:5432` (migrate) / txn pooler `:6543` (runtime) |
| Redis (cache + BullMQ) | **Upstash** | `rediss://` URL, shared by Vercel web + Render jobs |
| Media | **stub** for now | flip to Supabase Storage in Phase 3 |

### Prep done (2026-06-08)

- **`vercel.json`** — `framework: nextjs`, `regions: ["sin1"]`. Does **not** set `NEXT_STANDALONE`, so Vercel uses its native build (not the Docker standalone output).
- **`render.yaml`** — rewritten to the jobs host: dropped the `web` service, the managed `databases:` block, and the managed `redis` service. `DATABASE_URL` / `APP_DATABASE_URL` / `REDIS_URL` are now external secrets (Supabase + Upstash), not `fromDatabase`/`fromService` wiring. Added `APP_DATABASE_URL` (the worker constructs both DB clients at module load).
- **Production build verified** locally with `next build` (no `NEXT_STANDALONE`) — the exact build Vercel runs.

### Vercel — env vars (web role)

Set in Project → Settings → Environment Variables (Production). Mark connection strings + secrets as **Sensitive**.

| Var | Value |
|---|---|
| `NODE_ENV` | `production` |
| `DATABASE_URL` | Supabase **session** pooler `:5432`, user `postgres.<ref>` (migrator) |
| `APP_DATABASE_URL` | Supabase **txn** pooler `:6543`, user `app_user.<ref>` (runtime, NOBYPASSRLS) |
| `REDIS_URL` | Upstash `rediss://…` URL |
| `SESSION_SECRET` | 32+ char secret (same value as the jobs host) |
| `COOKIE_DOMAIN` | the storefront apex domain (e.g. `.example.com`) |
| `RATE_LIMIT_PER_MIN` | `120` (optional) |
| `METRICS_TOKEN` | optional bearer token for `/admin/metrics` |
| payment keys | `RAZORPAY_*` / `STRIPE_*` for the providers enabled in `site_config` |
| `MEDIA_PROVIDER` | `stub` (until Phase 3) |
| `SENTRY_DSN` | omit (Sentry stays opt-in/out-of-bundle) |

> No `ROLE` on Vercel — it defaults to `web`. Custom domains map to tenants via the existing host-header resolution (`store_domains`).
>
> **`NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` are NOT needed yet.** They're read only inside `src/utils/supabase/{client,server,middleware}.ts`, which nothing in the app imports today (the app's data path is Drizzle, not the Supabase JS client). The local `next build` passed *because it loaded the gitignored `.env`* where they happen to be set — Vercel has no `.env`, but since nothing imports them it doesn't matter. **Add both to Vercel Production when Phase 3 (Supabase Storage/Auth) wires those files in** — `NEXT_PUBLIC_*` are baked at build time, so a redeploy is required after adding them.

### To verify / known limitations

- **Node-runtime middleware on Vercel.** `src/middleware.ts` exports `runtime = 'nodejs'` and imports ioredis + prom-client (per-request rate-limit + tenant resolution). The build accepts it, but confirm Vercel runs Node-runtime middleware on the target plan after the first deploy — this is the class of thing that compiles clean and behaves differently in prod.
- **`COOKIE_DOMAIN` is a single value but the app is multi-tenant by custom domain.** A session cookie scoped to `.storeA.com` won't carry to `storeB.com`. Fine for a single-storefront go-live; a session-design limitation (not a Phase 5 config fix) the moment a second custom domain points in.
- **Readiness scope:** `next build` + these configs prove *compilation and topology*, not that the app serves data through the Supabase txn pooler + Upstash on Vercel. That's the runtime smoke test (go-live step 5) and is still unrun.

### Render — env vars (worker + scheduler)

Populate the `ecommerce-secrets` group (see `render.yaml`): same `DATABASE_URL`, `APP_DATABASE_URL`, `REDIS_URL`, `SESSION_SECRET`, `COOKIE_DOMAIN` as Vercel, plus payment/media keys. `REDIS_URL` must use the **`rediss://`** scheme (Upstash requires TLS; ioredis only enables TLS on `rediss://`).

`render.yaml` builds the image **directly from the repo** (`runtime: docker`, `dockerfilePath: ./docker/Dockerfile`) — no GHCR/CI push needed. Render clones `github.com/Thunderk3g/ecom@main`, builds `docker/Dockerfile` once, and runs it twice with `ROLE=worker` / `ROLE=scheduler`. `autoDeploy: true` rebuilds on push to `main`.

### Go-live order

1. **Provision Upstash** Redis (free tier; `maxmemory-policy noeviction` for BullMQ) → grab `rediss://` URL.
2. **Push** `git push origin main` (HTTPS :443 — works on the corporate network; only Postgres ports are blocked here).
3. **Vercel:** import `github.com/Thunderk3g/ecom`, set the env vars above, deploy. (Vercel's build infra has open egress, so it reaches Supabase even though this machine can't.)
4. **Render:** apply `render.yaml`, populate `ecommerce-secrets`, deploy worker + scheduler.
5. **Smoke test:** `/healthz` on Vercel returns `200` (postgres + redis ok); place a test order; confirm the scheduler frees a reservation after TTL and the worker dispatches a webhook.

### Network caveat (this machine)

The bajajlife.com network blocks outbound Postgres/Redis ports (5432/6543/6379) but **not** HTTPS :443. So `git push`, the Vercel/Upstash/Render dashboards, and their cloud builds all work from here — only **local** smoke-testing against Supabase/Upstash needs an unblocked network (mobile hotspot), as in Phase 2.

---

## Open decisions before Phase 4

- The stopgap Render worker host (decided 2026-06-08) covers jobs until Phase 4 moves them to Supabase pg_cron + Postgres queue + Edge Functions, at which point `render.yaml` and Redis/Upstash are retired.
