# Secrets

Baseline reference for every env var the platform treats as a secret or
operational tuning knob. The runtime contract is declared in `src/lib/env.ts`
(zod schema); the deploy-time inventory is in `render.yaml` (the
`ecommerce-secrets` env group). If you add a var, update both, then update
this doc.

Conventions:

- Render is the source of truth in prod. The `ecommerce-secrets` env group
  is shared across the `web`, `worker`, and `scheduler` services so a single
  edit reaches all three.
- `DATABASE_URL` and `REDIS_URL` are injected from the managed Render
  resources (`fromDatabase` / `fromService` in `render.yaml`) — never set by
  hand.
- Local dev reads `.env` (see `.env.example` for the floor). Tests load env
  via `tests/_setup` and do not require real provider credentials.
- CI (GitHub Actions) needs only what its job actually executes: typecheck,
  lint, test, and the docker build/push to `ghcr.io`. Provider credentials
  do not belong in CI unless a job actually calls the provider.

## Inventory

| Var | Required | Set in | Purpose |
|---|---|---|---|
| `NODE_ENV` | yes | Render service env / `.env` | One of `development` / `test` / `production`. |
| `ROLE` | yes | Render (per service) / `.env` | Selects entrypoint: `web` \| `worker` \| `scheduler`. |
| `PORT` | yes (web) | Render web service / `.env` | HTTP listen port for the web role. |
| `LOG_LEVEL` | no | Render env group / `.env` | Pino level. Defaults `info` in prod, `debug` in dev. |
| `DATABASE_URL` | yes | Render (`fromDatabase`) / `.env` | Postgres connection string. The user is `app_migrator`; the migrator role owns DDL and runs `pnpm db:migrate`. |
| `REDIS_URL` | yes | Render (`fromService`) / `.env` | Redis 7 for cache, BullMQ queues, rate limiter, tenant cache. |
| `SESSION_SECRET` | yes | Render secret / `.env` | HMAC key for the session cookie. Must be >= 32 chars. Generate with `openssl rand -hex 32`. |
| `COOKIE_DOMAIN` | yes | Render secret / `.env` | Cookie domain scope. `localhost` in dev; the apex domain (or `.example.com` for cross-subdomain) in prod. |
| `METRICS_TOKEN` | no | Render secret | Bearer token for `GET /admin/metrics`. If unset the endpoint is loopback-only (see `src/app/admin/metrics/route.ts`). |
| `RATE_LIMIT_PER_MIN` | no | Render env group / `.env` | Default per-IP rate-limit ceiling used by `withRateLimit` when callers don't pass an explicit `limit`. Defaults `120`. |
| `SENTRY_DSN` | no | Render secret | Server-side Sentry DSN. Unset = error reporting no-ops (see `src/lib/sentry.ts`). |
| `RAZORPAY_KEY_ID` | prod-conditional | Render secret | Razorpay public key id. Required iff a tenant has Razorpay enabled in `site_config`. |
| `RAZORPAY_KEY_SECRET` | prod-conditional | Render secret | Razorpay secret. Same condition. |
| `RAZORPAY_WEBHOOK_SECRET` | prod-conditional | Render secret | HMAC secret for verifying Razorpay webhook signatures. |
| `STRIPE_SECRET_KEY` | prod-conditional | Render secret | Stripe secret API key. Required iff Stripe enabled. |
| `STRIPE_WEBHOOK_SECRET` | prod-conditional | Render secret | Stripe webhook signing secret (`whsec_...`). |
| `MEDIA_PROVIDER` | yes | Render env group / `.env` | Selects media backend: `r2-imgproxy` in prod, `stub` for tests/dev. |
| `R2_ACCOUNT_ID` | prod | Render secret | Cloudflare account id; combined with `R2_BUCKET` builds the S3 endpoint URL. |
| `R2_ACCESS_KEY_ID` | prod | Render secret | R2 API token key id. Scoped Object Read+Write on the one bucket. |
| `R2_SECRET_ACCESS_KEY` | prod | Render secret | R2 API token secret. |
| `R2_BUCKET` | prod | Render secret | R2 bucket name (e.g. `prod-stationery-media`). |
| `R2_PUBLIC_BASE_URL` | prod | Render secret | Public URL prefix for derivatives — either the R2 public bucket URL or a custom CDN domain. |
| `IMGPROXY_BASE_URL` | prod | Render secret | imgproxy origin (e.g. `https://img.example.com`). |
| `IMGPROXY_KEY` | prod | Render secret | imgproxy signing key (hex). Without it derivative URLs cannot be signed. |
| `IMGPROXY_SALT` | prod | Render secret | imgproxy signing salt (hex). |

Notes:

- The schema in `src/lib/env.ts` marks every payment / R2 / imgproxy /
  Sentry / metrics var as `optional()`. They are listed above as "prod" or
  "prod-conditional" because the providers themselves throw at first use
  if the keys are missing, and `MEDIA_PROVIDER=r2-imgproxy` (the prod
  default in `render.yaml`) will fail on first upload without R2 creds.
- There is no `NEXT_PUBLIC_*` Sentry DSN. Browser error reporting is not
  wired today; `SENTRY_DSN` is server-only via `@sentry/node`. If a
  browser DSN gets added later, add it here and to `src/lib/env.ts`.
- There is no separate `R2_ENDPOINT` var. The S3 endpoint is derived from
  `R2_ACCOUNT_ID` (`https://<account>.r2.cloudflarestorage.com`). See
  `docs/r2-setup.md`.

## What breaks if a value is wrong

| Var | Symptom |
|---|---|
| `SESSION_SECRET` too short / missing | Process refuses to boot — `parseEnv()` throws "SESSION_SECRET must be at least 32 chars". |
| `SESSION_SECRET` rotated | All existing sessions invalidate; admins + customers are signed out. Carts created via guest `cart_sid` survive (separate cookie). |
| `DATABASE_URL` wrong | Boot fails or `/healthz` returns `503 {checks.postgres:"fail"}`. Migrations fail with a connection error. |
| `DATABASE_URL` points to a non-`app_migrator` role | Migrations succeed only if the role has DDL; runtime queries succeed but RLS `SET LOCAL app.store_id` still works because the role is configured to bypass via `with-tenant`. Mis-roling shows up as denied RLS reads. |
| `REDIS_URL` wrong | `/healthz` returns `503 {checks.redis:"fail"}`; rate limiter and tenant cache fall open / degrade; BullMQ queues stop producing/consuming. |
| `COOKIE_DOMAIN` mismatch | Login appears to succeed but the cookie is not sent on subsequent requests — admins keep being bounced to `/admin/login`. |
| `RAZORPAY_*` missing in prod | Checkout-start returns a 500 from the Razorpay provider constructor ("missing credentials"). Webhook deliveries fail signature verification (`401 invalid-signature`). |
| `STRIPE_SECRET_KEY` / `STRIPE_WEBHOOK_SECRET` missing in prod | Same as above for Stripe. |
| `R2_*` missing with `MEDIA_PROVIDER=r2-imgproxy` | Admin asset upload-url endpoint 500s; existing assets continue to serve via cached URLs until they expire. |
| `IMGPROXY_KEY` / `IMGPROXY_SALT` missing | Derivative URL signing throws; images render as broken (the signed URL never reaches imgproxy). |
| `METRICS_TOKEN` missing in prod | `/admin/metrics` is loopback-only — external scrapes get 403. Not a runtime fault per se. |
| `SENTRY_DSN` missing | Error reporting no-ops; exceptions still land in Pino logs. |

## Rotation playbook

All rotations are manual in v1. The shape is the same: update the value
in the Render `ecommerce-secrets` env group, trigger a redeploy of the
three services, verify, then revoke the old credential at the provider.

1. **`SESSION_SECRET`**
   - Generate: `openssl rand -hex 32`.
   - Render dashboard → Env Groups → `ecommerce-secrets` → edit
     `SESSION_SECRET` → Save → redeploy `web` (worker/scheduler don't read
     it but redeploy them too to stay homogeneous).
   - Expect every signed-in user (admins and customers) to be logged out.
     Communicate the maintenance window if needed.

2. **`DATABASE_URL` / `REDIS_URL`**
   - These come from the managed resources via `fromDatabase` /
     `fromService`. To rotate, rotate the underlying credential in the
     resource's settings; Render re-injects on the next deploy.
   - Verify with `GET /healthz`.

3. **`RAZORPAY_KEY_ID` / `RAZORPAY_KEY_SECRET`**
   - Generate a new key pair in the Razorpay dashboard (Settings →
     API Keys). Keep the old pair active.
   - Update both in Render → redeploy.
   - Run a smoke checkout in a test tenant; on success, deactivate the
     old key pair in Razorpay.

4. **`RAZORPAY_WEBHOOK_SECRET`**
   - In Razorpay (Settings → Webhooks), generate a new secret on the
     webhook endpoint. Razorpay supports overlapping secrets briefly.
   - Update in Render → redeploy → confirm recent webhook deliveries
     succeed (`/admin/webhooks/[id]/deliveries`).

5. **`STRIPE_SECRET_KEY`**
   - Stripe dashboard → Developers → API keys → roll the restricted key.
   - Update Render → redeploy → run a smoke checkout → revoke old key.

6. **`STRIPE_WEBHOOK_SECRET`**
   - Stripe dashboard → Developers → Webhooks → endpoint → roll signing
     secret. Stripe shows the new secret only once.
   - Update Render → redeploy → confirm deliveries succeed → expire old
     secret.

7. **`R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY`**
   - Cloudflare dashboard → R2 → Manage R2 API Tokens → create a new
     token with Object Read+Write scoped to the bucket.
   - Update both in Render → redeploy → smoke-test an admin asset upload
     → delete the old token.

8. **`IMGPROXY_KEY` / `IMGPROXY_SALT`**
   - Generate new hex values (`openssl rand -hex 32` each). Roll them on
     the imgproxy server at the same time you roll them in Render — they
     must match or every derivative URL 403s. There is no overlap window.
   - Plan for a brief broken-image window or pre-warm cache after rotation.

9. **`METRICS_TOKEN`**
   - Generate a random string (`openssl rand -hex 24` is plenty).
   - Update in Render → redeploy → update the Prometheus / Grafana scrape
     job's bearer token.

10. **`SENTRY_DSN`**
    - Sentry → Project → Settings → Client Keys (DSN) → create a new key,
      rotate the value, then disable the old key after redeploy.

11. **`COOKIE_DOMAIN`** (not really a secret, but a sensitive config)
    - Changing the value invalidates every existing cookie scoped to the
      old value. Coordinate with a DNS / domain change; don't drift this
      independently.
