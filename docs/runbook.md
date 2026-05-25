# Operations Runbook

Concise deploy / rollback / incident-triage reference for the ecommerce
platform. Three runtime roles (`web`, `worker`, `scheduler`) ship from one
Docker image; tenancy is enforced by Postgres RLS. See `render.yaml` for the
service topology and `CLAUDE.md` for the non-negotiables.

## Architecture at a glance

| Role        | Process                         | Serves                         |
|-------------|---------------------------------|--------------------------------|
| `web`       | `node server.js` (Next standalone) | Storefront, `/admin`, `/api/v1`, `/healthz`, `/admin/metrics` |
| `worker`    | `tsx src/entrypoints/worker.ts` | BullMQ queues (emails, imports, webhooks, image post-process, TTL sweeps) |
| `scheduler` | `tsx src/entrypoints/scheduler.ts` | Cron enqueues (TTL sweeps, reports, sitemap) |

`ROLE` env var selects the entrypoint. All roles read the same
`DATABASE_URL` / `REDIS_URL`.

## Deploy

1. Merge to `main`. CI (`.github/workflows/ci.yml`) runs lint → typecheck →
   migrate → tests → build, then builds and pushes `ghcr.io/OWNER/ecommerce:latest`.
2. Render auto-deploys the three services from the new image (`autoDeploy: true`).
3. **Migrations are forward-only.** They run via `pnpm db:migrate` (the
   `app_migrator` role). Run migrations once per release before/at deploy — they
   are idempotent and additive; never write a down-migration, roll forward with
   a fix migration instead.
4. Verify post-deploy:
   - `GET /healthz` → `200 {"status":"ok"}` (checks process, Postgres, Redis).
   - `GET /admin/metrics` (with `Authorization: Bearer $METRICS_TOKEN`) → exposition text.
   - Watch worker logs for queue drain; scheduler logs for the next cron tick.

## Rollback

Render keeps prior deploys. To roll back:

1. Render dashboard → service → **Deploys** → pick the last-good deploy → **Rollback**.
   Do this for `web`, `worker`, and `scheduler` together (same image tag).
2. If a **migration** is implicated: do NOT roll the DB back. Author and deploy a
   forward fix migration. Schema changes here are designed to be additive and
   backward compatible with the previous app version for exactly this reason.
3. Confirm `/healthz` green and error rate (Sentry) settled before standing down.

## Configuration & secrets

- Secrets live in the Render `ecommerce-secrets` env group (`sync: false` keys),
  never in git. `DATABASE_URL`/`REDIS_URL` are injected from the managed
  Postgres/Redis resources.
- Rotation (manual in v1): update the value in the env group → redeploy. For
  `SESSION_SECRET` rotation, expect existing sessions to invalidate.
- Optional observability env: `METRICS_TOKEN` (gates `/admin/metrics`; if unset
  the endpoint is loopback-only), `RATE_LIMIT_PER_MIN` (default 120),
  `SENTRY_DSN` (error reporting; no-ops when unset).

## Observability

- **Logs:** Pino JSON to stdout, shipped via Render log drains. Every request
  carries `req_id` (set by `src/middleware.ts` `x-request-id`, echoed on the
  response). Grep a `req_id` to trace one request end-to-end.
- **Metrics:** `GET /admin/metrics` — Prometheus exposition. Key series:
  `requests_total{method,route,status}`, `request_duration_seconds` (histogram),
  `build_info`, plus default process metrics. Scrape into Grafana Cloud.
- **Errors:** Sentry (`SENTRY_DSN`). `captureException` is best-effort and never
  throws on a hot path.

## Incident triage

1. **Is it up?** `GET /healthz`. A `503` body names the failing dependency
   (`postgres`/`redis`/`process`).
2. **Scope it.** Pull recent logs, filter by `req_id` / `store_host` / status.
   Spike of `5xx` on one route → check that module; spike across all → infra.
3. **Database:** check Render Postgres connections (pool exhaustion shows as
   timeouts) and CPU. RLS denials surface as empty/forbidden results — verify
   `app.store_id` is being set by middleware/`with-tenant`.
4. **Queues stuck:** inspect Redis + worker logs. A crash-looping worker leaves
   jobs in `active`; restart the worker service to re-drain. TTL reservation
   sweeps not running → check the scheduler service is live.
5. **Abuse / overload:** rate limiter is Redis sliding-window
   (`src/lib/rate-limit.ts`), applied per-IP via `withRateLimit` on protected
   handlers. Tighten `RATE_LIMIT_PER_MIN` or add `keyFn` per-customer limits.
6. **Roll back** (see above) if a recent deploy correlates with the incident.

## Backups & DR

- **Postgres:** Render managed daily backups (free tier 7-day retention; upgrade
  plan for PITR). Restore = create a new DB from a backup, point `DATABASE_URL`,
  redeploy. Test the restore path in staging quarterly.
- **R2 object storage:** enable bucket versioning; assets are content-addressed
  derivatives and can be regenerated from originals via the image pipeline.
- **Redis:** treated as ephemeral (cache + queues). Loss drops in-flight jobs;
  reservation TTL sweeps and idempotency keys self-heal. No backup required.
