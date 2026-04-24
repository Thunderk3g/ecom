# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

A configurable, reusable ecommerce platform tailored for stationery stores. One codebase is designed to power many storefronts: per-store customization comes from layered configuration, theme tokens, CMS content, and asset swaps — not forks. The system is shaped as a composable modular monolith: a single Next.js App Router application, internally organized as service-per-module, serving storefront, admin, and API surfaces from one deployment and running as three runtime roles from one Docker image.

## Repo state

Greenfield. No code, no `package.json`, no scaffolding, no git repo initialized yet. The only existing content is the master architecture spec at `docs/superpowers/specs/2026-04-24-stationery-ecommerce-platform-design.md`. Everything described below as "planned" does not yet exist on disk — treat the spec as the source of truth for shape and the future plans under `docs/superpowers/plans/` as the source of truth for how each piece will be built.

## Tech stack (planned)

- Next.js (App Router) + TypeScript — single app for storefront, admin, and `/api/v1`.
- PostgreSQL 15+ — tenant data, Row-Level Security for multi-tenancy.
- Redis 7+ — cache and BullMQ queues.
- S3-compatible object storage — Cloudflare R2 primary.
- BullMQ — background jobs (emails, CSV imports, webhooks, image post-process, reservation TTL sweeps, search reindex).
- Drizzle ORM — schema and forward-only migrations.
- Lucia-style sessions — auth for customers and admin users.
- Tailwind + shadcn/ui — storefront and admin UI.
- Pino — structured JSON logs.
- imgproxy — image derivative pipeline (swappable with Cloudflare Images).

## Runtime roles

One Docker image, three processes selected by the `ROLE` env var:

- `web` — Next.js server: SSR/ISR storefront (`/`), admin UI (`/admin`), REST API (`/api/v1`), upload-URL signing.
- `worker` — BullMQ consumer: `emails`, `csv.imports`, `inventory.alerts`, `search.reindex`, `webhook.dispatch`, `image.post-process`, `reservation.ttl.sweep`.
- `scheduler` — cron-like enqueuer: TTL sweeps, daily reports, sitemap regen.

All three share the same codebase and module services; only the entrypoint differs.

## Sub-projects

The spec decomposes delivery into nine sub-projects. Each gets its own spec → plan → implementation cycle:

1. SP-1 — Foundation & tenancy (Next.js + Drizzle + Postgres RLS + auth + `site_config` loader).
2. SP-2 — Catalog (products, variants, categories, attributes, bundles, search).
3. SP-3 — Inventory (stock movements, reservations, thresholds, suppliers).
4. SP-4 — Cart & checkout (cart, pricing, promotions, tax, shipping, payment intents).
5. SP-5 — Order lifecycle (orders, fulfillment, refunds, webhooks).
6. SP-6 — Admin dashboard (CRUD UIs, CSV import, bulk edit, analytics).
7. SP-7 — CMS & theming (content blocks, homepage builder, theme tokens).
8. SP-8 — Asset library & image pipeline (SVG sprite, direct-upload, derivatives).
9. SP-9 — Deployment & observability (Docker, Render, Cloudflare R2, CI/CD, metrics).

Ordering constraint: SP-1 first. SP-2 and SP-3 may parallelize after SP-1. SP-4 and SP-5 follow catalog + inventory. SP-6 and SP-7 may parallelize on top. SP-8 and SP-9 bracket the lot (SP-8 is needed early-enough for CMS imagery; SP-9 finalizes the delivery path).

## Conventions & non-negotiables

These apply to every sub-project unless a plan explicitly calls out a deviation with justification:

- **Multi-tenancy via RLS.** Every tenant-scoped table carries `store_id`; RLS policies gate reads and writes against `current_setting('app.store_id')::uuid`. See the policy pattern in spec §5.7. Middleware resolves tenant from host header and issues `SET LOCAL app.store_id` on every request.
- **Forward-only Drizzle migrations.** No down-migrations in prod; roll forward with a fix migration.
- **Password hashing:** argon2id only.
- **CSRF on admin mutations.** Double-submit or synchronizer-token pattern; storefront cookie session includes CSRF for mutating endpoints.
- **Strict CSP and HSTS.** PII encrypted at rest; PCI scope minimized via provider tokenization.
- **Errors follow RFC 7807** — `{ type, title, status, detail, errors: [...] }`.
- **Cursor pagination** — `?after=<opaque>&limit=50`, hard cap 200. No offset pagination.
- **`Idempotency-Key` header required** on non-GET checkout endpoints and admin mutating endpoints.
- **API versioning** — URL major (`/api/v1`); additive fields are non-breaking.
- **Health check** — `/healthz` endpoint required for every role.
- **Logs** — Pino JSON only; no `console.log` in shipped code.

## Source of truth

- **Architecture spec (charter):** `docs/superpowers/specs/2026-04-24-stationery-ecommerce-platform-design.md` — domain model, DB schema, API surface, UI map, config shape, deployment, non-functional targets.
- **Per-SP plans:** `docs/superpowers/plans/` — one plan per sub-project, added as each SP is planned. Before touching code for any SP, confirm its plan exists here and has been reviewed.
- **Spec §16 defaults are the current choices** unless a plan overrides them: India market (INR, GST inclusive), Razorpay + Stripe, Render hosting, Postgres FTS + pg_trgm search, imgproxy, Drizzle, Lucia-style sessions, shadcn/ui + Tailwind admin. Each is reversible per the mechanism listed in §16.

## Working with Claude

Future sessions working in this repo should:

1. **Read the spec first.** `docs/superpowers/specs/2026-04-24-stationery-ecommerce-platform-design.md` is the architecture charter. Do not propose shape-level changes without reconciling against it.
2. **Check for an existing plan** in `docs/superpowers/plans/` for the sub-project you are about to touch. If one exists, it supersedes ad-hoc design choices for that SP.
3. **Prefer the `writing-plans` skill before writing code** for any sub-project. Each SP is large enough to warrant a plan; jumping straight to code bypasses the spec→plan→implement rhythm this project is set up for.
4. **Treat spec §16 defaults as the current choices** unless the relevant plan overrides them. If a user request implies changing a default, surface the choice explicitly and update `site_config` / plan rather than hardcoding.
5. **Do not fabricate paths.** `src/`, `drizzle.config.ts`, etc. do not exist yet. When discussing them, frame them as planned.
6. **Respect the non-negotiables above** even during scaffolding — RLS, forward-only migrations, argon2id, RFC 7807, cursor pagination, and `Idempotency-Key` are load-bearing for the whole design and are cheaper to get right from day one.
