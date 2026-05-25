# SP-9: Deployment & Observability — Implementation Plan

> Use superpowers:subagent-driven-development.

**Goal:** Finalize the production deployment path on Render (per spec §16): Docker multi-stage build, three-role process management (web, worker, scheduler), Cloudflare R2, managed Postgres + Redis, CI/CD via GitHub Actions, structured metrics + alerting. The Docker image and CI workflow already exist from SP-1; SP-9 hardens and extends.

---

## Scope

**Deployment:**
- Production-grade `docker/Dockerfile` (already exists; verify multi-stage + standalone Next + non-root user + healthcheck)
- `render.yaml` — three services + Postgres + Redis + cron settings
- Secrets management: Render env vars (DATABASE_URL, REDIS_URL, RAZORPAY_*, STRIPE_*, R2_*, SESSION_SECRET, CSRF_SECRET)
- Custom domain config via Render + Cloudflare DNS

**Observability:**
- Pino → log shipping to Render's log drains (or BetterStack/Logtail)
- Request tracing: add `req_id` to all logs via Next.js middleware (`x-request-id` header)
- Metrics endpoint: `/admin/metrics` (Prometheus exposition format) — counter `requests_total`, histogram `request_duration_seconds`, gauge `queue_depth`, gauge `db_pool_size`
- Sentry SDK for error tracking — server + browser

**Alerting:**
- Render alarms on instance health
- Sentry alerts on error rate spikes
- Custom dashboards in Grafana Cloud (free tier) consuming the Prometheus endpoint

**CI/CD:**
- Existing `.github/workflows/ci.yml` runs typecheck + tests
- Add: build the Docker image, push to ghcr.io
- Render auto-deploys from main
- Pre-merge: required green CI

**Backups + DR:**
- Postgres: Render's daily managed backups (7-day retention free tier; extend if needed)
- R2: versioning on bucket
- Recovery runbook in `docs/runbook.md`

**Performance:**
- Verify Next standalone bundle ships
- Configure `unstable_cache` defaults + revalidate timers
- Connection pooling (postgres-js's pool already configured; tune `max`)

---

## Tasks (high-level)

1. Audit + harden `docker/Dockerfile` (verify multi-stage, distroless or alpine, non-root, COPY only what's needed)
2. Render.yaml with three services (web, worker, scheduler) + Postgres + Redis attachments
3. Secrets baseline in Render dashboard; document in `docs/secrets.md`
4. Cloudflare R2 bucket creation + CORS + API token doc
5. Custom domain DNS guide
6. Request-id middleware
7. Pino transport for log drain
8. Prometheus metrics endpoint + collectors
9. Grafana dashboard JSON committed
10. Sentry integration (next/sentry + worker init)
11. Backup verification: restore test in staging
12. Runbook: deploy / rollback / hotfix / incident triage
13. Load test (k6 script) for storefront list + checkout flow
14. Security review: CSP headers, HSTS, cookie flags, rate limiting (use Redis with sliding window)
15. Rate limiting middleware on `/api/v1/*` (per-IP + per-customer)
16. CI: docker build + ghcr push
17. CHANGELOG.md scaffold for release notes

---

## Risks

1. **Cold starts** on Render free tier — first request after idle is slow. Either pay for always-on or use a keepalive ping.
2. **Cloudflare R2 egress** — free up to monthly quota; budget alarms recommended.
3. **Database connections** — Render Postgres has connection limits; ensure pool max is conservative.
4. **Secret rotation** — document the playbook; v1 doesn't automate.
5. **GDPR / DPDP** — India DPDP and global GDPR concerns: data export + delete endpoints, privacy policy linked from footer. Add as compliance follow-up.
