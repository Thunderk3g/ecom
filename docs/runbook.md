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

## Hotfix flow

For a one-off fix that needs to ship faster than the normal feature cadence
but still goes through CI:

1. Branch from `main`, commit the fix, open a PR. Keep the diff narrow —
   one cause, one fix, one test if practical.
2. Merge to `main` once CI is green. CI builds `ghcr.io/OWNER/ecommerce:latest`;
   Render's `autoDeploy: true` picks it up.
3. While Render rolls the three services, watch:
   - Build & deploy logs in Render until the new revision is "Live".
   - `GET /healthz` on a tenant host — expect `200 {"status":"ok"}`.
   - `GET /admin/metrics` — `requests_total` continues to climb, no
     unexpected `status="5.."` series.
4. Tag the commit (`git tag hotfix-YYYY-MM-DD-<slug>` and push) once
   `/healthz` has been green for 5 min, so the rollback target is named.
5. Add a CHANGELOG entry under `## [Unreleased] → ### Fixed` (or
   `### Security`) before closing the incident.

If the fix requires a schema change, follow the standard forward-only
migration discipline — the hotfix doesn't earn a down-migration. Land the
DDL in the same PR or its own ahead-of-app PR, deployed first.

## Sentry triage

When a Sentry alert fires (error-rate spike, new-issue email, or a
manually-watched issue):

1. **Open the issue** in Sentry. Scope filter to `environment:production`
   and the last hour.
2. **Read the breadcrumb trail and the tagged `req_id`.** The platform
   stamps `x-request-id` on every request (`src/middleware.ts`); Sentry
   captures it via `captureException(err, { extra: { reqId } })` at the
   call site. Copy the `req_id`.
3. **Pull the matching log line** in Render logs: filter by `req_id`.
   You get the whole request: route, status, duration, store_host.
4. **Decide:**
   - **Known and noisy:** silence/merge the issue and add a Sentry rule
     for the fingerprint. Don't suppress globally; suppress per-error.
   - **Real bug, low blast radius:** assign, file a fix, schedule. No
     paging.
   - **Real bug, high blast radius (5xx spike, checkout broken, auth
     broken):** treat as an incident — see *Incident triage* above and
     consider rollback if it correlates with the last deploy.
5. **Confirm fix.** Resolve the Sentry issue with the fix's commit SHA;
   Sentry will reopen if the same fingerprint reappears post-deploy.

Sentry capture is best-effort and never throws on a hot path
(`src/lib/sentry.ts`). If Sentry itself is down, exceptions still land in
Pino logs — fall back to log search.

## Metrics-driven alert response

The Prometheus endpoint exposes the series the platform dashboard
(`dashboards/grafana-platform.json`) reads. Alert rules should be
configured in Grafana / Prometheus; the response shape is the same
regardless of where the alert came from.

### High error rate

Symptom: `rate(requests_total{status=~"5.."}[5m])` jumps above the alert
threshold.

1. Identify the route(s): group the same query by `route`. A spike on
   one route narrows the surface to one module.
2. Sample a Pino log line for a `req_id` on that route with `status>=500`.
   The stack trace + `err` field name the failing call.
3. Cross-check Sentry for a fingerprint that matches.
4. Common causes and first checks:
   - **DB:** `/healthz` `checks.postgres`; Render Postgres CPU and
     active-connection chart. Connection-pool exhaustion shows as
     `timeout exceeded when trying to acquire a connection` in logs.
   - **Redis:** `/healthz` `checks.redis`. Rate-limit failures and
     idempotency-key conflicts surface here.
   - **Payment provider:** check provider status pages; webhook
     deliveries may also be failing (`/admin/webhooks`).
5. Mitigate: rollback (per *Rollback* above) if a recent deploy
   correlates; otherwise patch and hotfix.

### Queue backup

Symptom: `queue_depth{queue=...}` grows without bound, or a queue's
`active` count stays >0 with depth >0 for minutes.

1. Pick the queue from the label set. Common queues: `emails`,
   `csv.imports`, `inventory.alerts`, `search.reindex`, `webhook.dispatch`,
   `image.post-process`, `reservation.ttl.sweep`.
2. Check the `worker` service logs — a crash-looping handler leaves
   jobs in `active`; a slow handler grows `waiting`.
3. Restart the `worker` service to re-drain stuck `active` jobs;
   BullMQ's stalled-job recovery returns them to `waiting`.
4. If the producer is the scheduler (TTL sweep, reports), check the
   `scheduler` service logs for the next tick — a dead scheduler shows
   as `queue_depth` plateauing rather than spiking.
5. If a single bad job is poisoning the queue, inspect with BullMQ
   tooling and move it to a dead-letter set rather than retrying
   forever.

### Latency spike

Symptom: `histogram_quantile(0.95, …request_duration_seconds_bucket…)`
exceeds the SLO (browse: 800ms, checkout: 1500ms — see
`tests/load/k6-storefront.js`).

1. Group the quantile by `route` to find the offender(s).
2. Sample a few `req_id`s on that route and check the log durations.
   The Pino log line includes per-request timing.
3. Common causes:
   - **DB query slowdown:** add `EXPLAIN` to the offending query;
     check for a missing index, a recent migration that added a column
     without an index, or a stats-out-of-date situation (run
     `ANALYZE`).
   - **Tenant-cache thrash:** `tenant:domain:*` misses spike when a
     new domain is added. Expected; flat after the first request.
   - **Render plan saturation:** CPU / memory at the instance ceiling.
     Scale up; or check for a runaway worker pinning the box.
   - **External provider latency:** payment provider intent creation
     dominates checkout p95. Webhook deliveries can stall on
     destination slowness — see `/admin/webhooks/[id]/deliveries`.
4. If correlated with a deploy: rollback. If not: file a perf issue
   and schedule.
