---
title: Stationery Ecommerce Platform — Master Design
date: 2026-04-24
status: draft (awaiting user review)
owner: Lead Systems Architect
---

# Stationery Ecommerce Platform — Master Design

A configurable, reusable ecommerce platform tailored for stationery stores. A single codebase powers many storefronts; per-store customization comes from configuration, theme tokens, CMS content, and asset swaps — not forks.

## 0. Executive Overview

- **Shape:** Composable modular monolith (single Next.js app, service-per-module internally), multi-tenant on one Postgres via Row-Level Security.
- **Stack:** Next.js (App Router) + TypeScript, PostgreSQL 15+, Redis 7+, S3-compatible object storage, BullMQ workers, Drizzle ORM.
- **Frontend:** Storefront (`/`), Admin (`/admin`), API (`/api/v1`) from one deployment; three runtime roles — web, worker, scheduler — from one Docker image.
- **Configurable:** Layered config (platform defaults → DB `site_config` row → env overrides) drives branding, theme, payments, shipping, tax, feature flags, homepage blocks.
- **Domain anchor:** Stationery-first taxonomy (notebooks, pens, art, office, school), typed-JSONB attributes, SKU convention, bundles, school-list use cases.

## 1. Scope & Sub-Project Decomposition

This master spec is the **architecture charter**. Because the surface spans ~8 subsystems, it is too large for a single implementation plan. Each sub-project below will get its own spec → plan → implementation cycle:

1. **SP-1 — Foundation & tenancy** — Next.js + Drizzle + Postgres RLS + auth + site_config loader.
2. **SP-2 — Catalog** — products, variants, categories, attributes, bundles, search.
3. **SP-3 — Inventory** — stock movements, reservations, thresholds, suppliers.
4. **SP-4 — Cart & checkout** — cart, pricing, promotions, tax, shipping, payment intents.
5. **SP-5 — Order lifecycle** — orders, fulfillment, refunds, webhooks.
6. **SP-6 — Admin dashboard** — CRUD UIs, CSV import, bulk edit, analytics.
7. **SP-7 — CMS & theming** — content blocks, homepage builder, theme tokens.
8. **SP-8 — Asset library & image pipeline** — SVG sprite, direct-upload, derivatives.
9. **SP-9 — Deployment & observability** — Docker, Render, Cloudflare R2, CI/CD, metrics.

Ordering: SP-1 first; SP-2/SP-3 can parallelize after; SP-4/SP-5 follow catalog+inventory; SP-6/SP-7 can parallelize on top; SP-8/SP-9 bracket the lot.

## 2. Domain Model Summary (Phase 1 synthesis)

### 2.1 Product domain

- **Top-level categories:** Notebooks, Pens & Writing, Art Supplies, Office Supplies, School Supplies, Paper & Stationery, Bags & Cases, Gifting.
- **Attribute families** (typed, registered in `attribute_definitions`):
  - *Common:* brand, material, color, size, weight, country_of_origin.
  - *Notebooks:* ruling (plain/ruled/grid/dotted), pages, gsm, binding, paper_type.
  - *Pens:* ink_type, tip_size, refillable, body_material.
  - *Art:* medium, skill_level, lightfastness, piece_count.
- **SKU format:** `CAT-BRAND-PRODUCT-VARIANT` e.g. `PEN-PLT-V5H-BLU05`.
- **Variants:** axis set — size × color × pack_quantity — with per-variant price, stock, images.
- **Bundles:** product subtype with `bundle_components`; fixed bundle price; inventory decrements components on fulfillment.

### 2.2 Inventory domain

- Event-sourced: immutable `stock_movements` log (inbound, outbound, adjustment, reservation, release, transfer).
- Materialized `stock_levels(variant_id, location_id)` rebuilt from movements; authoritative figure for UI.
- **Locations:** warehouse, store-front, transit; multi-location per store supported.
- **Reservation:** at checkout-start, TTL 15 min, row-level `FOR UPDATE`; release on timeout or abandon.
- **Commit:** on payment success, reservation → outbound movement.
- **Thresholds:** per variant `reorder_point`, `reorder_qty`; low-stock alert emitted to queue.
- **Suppliers:** `suppliers` + `supplier_skus` mapping for reorder suggestions and cost tracking.
- **Batch tracking:** optional per-variant flag; `stock_batches` with expiry (for inks, paints).

### 2.3 Customer UX domain

- **Storefront surfaces:** home, category listing, product detail, cart drawer, checkout, account, order tracking, search, wishlist (flag), CMS pages.
- **Search:** Postgres full-text + trigram for typos; faceted filter on taxonomy + attribute registry.
- **Cart:** server cart for logged-in, localStorage for guest; merge on login.
- **Checkout:** 1-page or 3-step (configurable); guest allowed by flag; address autocomplete via config-selected provider.
- **Tracking:** order status timeline with tracking number + carrier deep-link.

### 2.4 Admin domain

- **Roles:** owner, manager, staff (RBAC permission strings).
- **Modules:** catalog, inventory, orders, customers, discounts, CMS, analytics, settings.
- **Bulk ops:** CSV import (products, inventory adjustments, customers), bulk edit, bulk price change, scheduled publish.
- **Analytics:** sales, AOV, conversion, low stock, top SKUs, returning customer rate.

## 3. Architecture Diagram (text)

```
                  ┌───────────────────────────────────────────────────┐
                  │                   Cloudflare / CDN                │
                  └──────────────┬────────────────────┬───────────────┘
                                 │ storefront         │ /_next/image
                                 ▼                    ▼
┌──────────────────────────────────────────────────────────────────────┐
│                      Next.js App (single image)                       │
│                                                                       │
│  ┌────────────┐   ┌────────────┐   ┌────────────┐   ┌─────────────┐  │
│  │ Storefront │   │   Admin    │   │  /api/v1   │   │  /_next/*   │  │
│  │ (SSR/ISR)  │   │   /admin   │   │  (REST)    │   │  assets     │  │
│  └─────┬──────┘   └──────┬─────┘   └─────┬──────┘   └──────┬──────┘  │
│        └──────┬──────────┴─────────┬─────┘                 │         │
│               ▼                    ▼                       │         │
│         ┌───────────┐       ┌────────────┐                 │         │
│         │  modules  │       │  services  │                 │         │
│         │  (UI)     │       │  (biz)     │                 │         │
│         └───────────┘       └─────┬──────┘                 │         │
│                                   │                        │         │
└───────────────────────────────────┼────────────────────────┼─────────┘
                                    │                        │
           ┌────────────────────────┼──────────┬─────────────┘
           ▼                        ▼          ▼
     ┌──────────┐             ┌─────────┐  ┌────────────┐
     │ Postgres │◄───RLS─────│  Redis  │  │  S3 / R2   │
     │ (tenant  │             │  cache  │  │  (assets   │
     │  data)   │             │  queues │  │   + media) │
     └────┬─────┘             └────┬────┘  └──────┬─────┘
          │                        │              │
          ▼                        ▼              ▼
     ┌─────────────┐        ┌───────────────┐ ┌─────────────┐
     │  Workers    │        │  Scheduler    │ │ imgproxy /  │
     │ (BullMQ)    │        │  (cron)       │ │ CF Images   │
     │ emails,     │        │ TTL sweeps,   │ └─────────────┘
     │ csv.import, │        │ reports,      │
     │ webhooks,   │        │ reindex       │
     │ images      │        └───────────────┘
     └─────────────┘
```

## 4. Module Map (runtime topology)

Three processes from one Docker image, separated by `ROLE` env var:

- **web** — Next.js server; handles SSR/ISR storefront, admin UI, `/api/v1/*`, direct-upload signing.
- **worker** — BullMQ consumer for queues: `emails`, `csv.imports`, `inventory.alerts`, `search.reindex`, `webhook.dispatch`, `image.post-process`, `reservation.ttl.sweep`.
- **scheduler** — cron-like, enqueues periodic jobs (TTL sweep, daily reports, sitemap regen).

Internal service modules (callable by web + worker):

| Module | Responsibility |
|---|---|
| `product` | catalog, variants, attributes, bundles |
| `inventory` | stock movements, levels, reservations, suppliers |
| `order` | cart → order → fulfillment lifecycle |
| `customer` | users, addresses, wishlist, segments |
| `payment` | provider abstraction (Razorpay, Stripe), webhooks |
| `promotion` | coupons, automatic discounts, rules |
| `cms` | content blocks, pages, homepage layout |
| `media` | upload signing, derivative requests, asset registry |
| `config` | layered config loader, cache, hot-reload |
| `search` | index maintenance, query, facets |
| `analytics` | event ingest, rollups, report queries |
| `auth` | sessions, RBAC, multi-tenancy middleware |

## 5. Database Schema

Single Postgres database, tenant-scoped tables carry `store_id`, RLS via `current_setting('app.store_id')::uuid`. Timestamps default to `now()`; soft deletes via `deleted_at` where applicable.

### 5.1 Tenancy & identity

```sql
stores                (id uuid pk, slug text unique, name text, created_at ts)
store_domains         (store_id, domain text unique, is_primary bool)
users                 (id uuid pk, email text, password_hash, locale, created_at)
store_users           (store_id, user_id, role text, permissions jsonb)  -- admin RBAC
customers             (id uuid pk, store_id, user_id nullable, email, phone, locale, created_at)
addresses             (id uuid pk, customer_id, type text, name, line1, line2, city,
                       region, postal, country, phone, is_default bool)
sessions              (id uuid pk, user_id, customer_id, expires_at, ip, user_agent)
```

### 5.2 Catalog

```sql
categories            (id, store_id, parent_id nullable, slug, name, description,
                       image_asset_id, sort_order, published bool)
attribute_definitions (id, store_id, key text, label, data_type text,  -- string|number|bool|enum
                       unit text, enum_values jsonb, filterable bool, required bool)
products              (id, store_id, slug, name, description_md, brand,
                       category_id, type text default 'simple',  -- simple|bundle
                       status text, attributes jsonb, tax_class text,
                       seo jsonb, published_at, deleted_at)
product_variants      (id, product_id, sku text unique, barcode, name,
                       axes jsonb,  -- {size:"A5", color:"blue", pack:5}
                       price_cents, compare_at_cents, cost_cents, weight_g,
                       images jsonb, status)
product_images        (id, product_id, variant_id nullable, asset_id, alt, sort_order)
bundle_components     (bundle_variant_id, component_variant_id, qty)
product_reviews       (id, product_id, customer_id, rating int, title, body,
                       status text, created_at)  -- feature-flagged
```

### 5.3 Inventory

```sql
locations             (id, store_id, code, name, type text)  -- warehouse|store|transit
stock_movements       (id bigserial, store_id, variant_id, location_id, qty int,
                       kind text, reason text, ref_type text, ref_id uuid,
                       batch_id nullable, created_by, created_at)
stock_levels          (variant_id, location_id, on_hand int, reserved int,
                       available int generated, updated_at)  -- materialized
stock_reservations    (id, variant_id, location_id, qty, cart_id, expires_at,
                       status text)  -- active|committed|released
stock_batches         (id, variant_id, location_id, batch_code, qty, expiry_date)
stock_thresholds      (variant_id, location_id, reorder_point int, reorder_qty int)
suppliers             (id, store_id, name, contact jsonb, lead_time_days)
supplier_skus         (supplier_id, variant_id, supplier_sku, cost_cents, moq)
purchase_orders       (id, store_id, supplier_id, status, placed_at, expected_at)
purchase_order_items  (po_id, variant_id, qty_ordered, qty_received, cost_cents)
```

### 5.4 Cart, order, payment

```sql
carts                 (id, store_id, customer_id nullable, session_id, currency,
                       subtotal_cents, discount_cents, tax_cents, shipping_cents,
                       total_cents, coupon_code, note, expires_at, updated_at)
cart_items            (cart_id, variant_id, qty, unit_price_cents, line_total_cents)
orders                (id, store_id, number text unique, customer_id, email,
                       status, payment_status, fulfillment_status,
                       billing_address jsonb, shipping_address jsonb,
                       currency, subtotal, discount, tax, shipping, total,
                       coupon_code, note, placed_at, cancelled_at)
order_items           (order_id, variant_id, sku, name, qty,
                       unit_price_cents, line_total_cents, tax_cents, attributes jsonb)
payments              (id, order_id, provider, provider_ref, amount_cents,
                       status, method, raw jsonb, created_at)
refunds               (id, payment_id, amount_cents, reason, status, raw jsonb)
shipments             (id, order_id, carrier, tracking_number, status,
                       shipped_at, delivered_at)
shipment_items        (shipment_id, order_item_id, qty)
```

### 5.5 Promotions, tax, shipping

```sql
promotions            (id, store_id, code, name, type text,  -- percent|amount|bxgy|free_ship
                       value_cents int, percent int, conditions jsonb,
                       starts_at, ends_at, usage_limit, used_count, status)
tax_rates             (id, store_id, region_code, rate numeric, label, inclusive bool)
shipping_zones        (id, store_id, code, regions jsonb, rates jsonb, free_over_cents)
```

### 5.6 CMS, media, config

```sql
content_pages         (id, store_id, slug, title, status,
                       published_version_id nullable, draft_version_id)
content_versions      (id, page_id, blocks jsonb, seo jsonb, created_by, created_at)
content_blocks_lib    (id, store_id, key, kind text, schema jsonb)  -- reusable block defs
navigation_menus      (id, store_id, slot text, items jsonb)  -- header, footer, mobile
assets                (id, store_id, key text, kind text,  -- image|svg|doc
                       mime, bytes int, width, height, checksum, meta jsonb,
                       uploaded_by, created_at)
asset_derivatives     (id, asset_id, preset text, width, height, url)
site_config           (store_id pk, config jsonb, updated_at, updated_by)
feature_flags         (store_id, key, enabled bool, payload jsonb)
```

### 5.7 Audit, events, jobs

```sql
audit_log             (id, store_id, actor_type, actor_id, action, entity_type,
                       entity_id, diff jsonb, created_at)
outbox_events         (id, store_id, topic, payload jsonb, status, created_at, delivered_at)
webhooks              (id, store_id, url, secret, topics text[], status)
webhook_deliveries    (id, webhook_id, event_id, response_code, body, attempts, next_try_at)
```

**Indexing highlights:** `(store_id, slug)` on products/categories/pages; GIN on `products.attributes` and `product_variants.axes`; trigram index on `products.name`; btree on `stock_movements(variant_id, created_at)`; partial unique on active `stock_reservations`.

**RLS policy pattern:**

```sql
ALTER TABLE products ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_read ON products FOR SELECT
  USING (store_id = current_setting('app.store_id', true)::uuid);
CREATE POLICY tenant_write ON products FOR ALL
  USING (store_id = current_setting('app.store_id', true)::uuid)
  WITH CHECK (store_id = current_setting('app.store_id', true)::uuid);
```

## 6. API Structure

REST under `/api/v1`, JSON, bearer-token for admin + partner, cookie session for storefront. Every request resolves tenant from host header → `store_id`, then `SET LOCAL app.store_id`.

### 6.1 Public storefront

```
GET    /api/v1/config                       — site_config (filtered: branding/theme/features)
GET    /api/v1/categories                   — tree
GET    /api/v1/products                     — list, filter, facet
GET    /api/v1/products/:slug               — detail + variants
GET    /api/v1/search?q=                    — typeahead + results
POST   /api/v1/cart                         — create
GET    /api/v1/cart/:id
POST   /api/v1/cart/:id/items
PATCH  /api/v1/cart/:id/items/:lineId
DELETE /api/v1/cart/:id/items/:lineId
POST   /api/v1/cart/:id/coupon
POST   /api/v1/checkout/start               — creates reservation + payment intent
POST   /api/v1/checkout/confirm             — post-payment callback
GET    /api/v1/orders/:number?email=        — guest lookup
POST   /api/v1/auth/signup|login|logout
GET    /api/v1/customer/me
GET    /api/v1/customer/orders
GET    /api/v1/pages/:slug                  — CMS page
```

### 6.2 Admin

```
/api/v1/admin/products (GET, POST, PATCH, DELETE)
/api/v1/admin/products/:id/variants
/api/v1/admin/products/import               — CSV (multipart → queue)
/api/v1/admin/categories
/api/v1/admin/inventory/levels
/api/v1/admin/inventory/adjust              — POST { variant_id, location_id, qty, reason }
/api/v1/admin/inventory/transfers
/api/v1/admin/suppliers
/api/v1/admin/purchase-orders
/api/v1/admin/orders
/api/v1/admin/orders/:id/fulfill
/api/v1/admin/orders/:id/refund
/api/v1/admin/customers
/api/v1/admin/promotions
/api/v1/admin/cms/pages
/api/v1/admin/cms/pages/:id/publish
/api/v1/admin/assets/upload-url             — returns pre-signed PUT URL
/api/v1/admin/config                        — GET/PUT site_config
/api/v1/admin/analytics/overview            — rollups
/api/v1/admin/audit-log
```

### 6.3 Webhooks (inbound + outbound)

```
POST /api/v1/webhooks/payments/:provider    — Razorpay/Stripe/etc
POST /api/v1/webhooks/carriers/:provider    — shipment updates
GET  /api/v1/admin/webhooks                 — partner webhook subscriptions
```

### 6.4 Conventions

- Pagination: cursor `?after=<opaque>&limit=50`, hard cap 200.
- Errors: RFC 7807 `{ type, title, status, detail, errors: [...] }`.
- Idempotency: `Idempotency-Key` header on non-GET checkout and admin mutating endpoints.
- Versioning: URL major (`/v1`); additive fields are non-breaking.

## 7. CMS Layer

- **Pages** live in `content_pages`; each page has a `published_version_id` pointer and a `draft_version_id`.
- **Publish** = transactional pointer swap; rollback = point to prior version.
- **Homepage** is a content page whose `blocks` JSON is rendered by a block registry (hero, featured-categories, product-grid, banner, rich-text, testimonials, CTA, newsletter).
- **Navigation** menus per slot (header, footer, mobile) — `navigation_menus.items` is a tree JSON.
- **Block schema validation** against `content_blocks_lib.schema` so admin UI can render generic forms.
- **Draft preview** via signed preview URL that forces draft render.

## 8. Asset Storage & Image Pipeline

- **Storage:** S3-compatible (Cloudflare R2 primary). `assets` table is the registry; object key is content-hashed (`assets/<sha256>.<ext>`).
- **Upload:** client calls `POST /admin/assets/upload-url`, receives pre-signed PUT; client uploads directly; worker job `image.post-process` extracts dimensions, checksum, EXIF strip, produces `asset_derivatives`.
- **Delivery:** `next/image` custom loader points at CDN with width/quality params; transformations via **imgproxy** (self-hosted) or **Cloudflare Images** (managed) — both swappable behind loader.
- **SVG pipeline:** SVGO-minified, `<symbol>` sprite generated by a CI step; runtime renders `<svg><use href="/sprites/icons.svg#icon-name"/></svg>`.

## 9. Configuration System

Layered, deterministic precedence — **env override > DB site_config > platform defaults**.

- `platform.defaults.ts` — ship-with-code fallbacks.
- `site_config` row — per-store JSONB, edited via admin UI.
- `process.env.*` — emergency override (e.g., pause payments, kill feature flag).
- Config loader caches per `store_id` in Redis; invalidated on admin write.
- Theme tokens from config are injected into `<style>` at SSR as CSS custom properties (`--color-bg`, `--color-accent`, `--font-sans`, `--radius`).

### 9.1 Example `site_config.json`

```json
{
  "brand": {
    "name": "Inkwell & Co",
    "logo_asset_id": "asset_abc123",
    "favicon_asset_id": "asset_fav001",
    "tagline": "Paper goods, properly."
  },
  "theme": {
    "color": {
      "bg": "#FAF6EE",
      "fg": "#1A1A2E",
      "primary": "#2C3E8C",
      "secondary": "#F2994A",
      "accent_warm": "#F2C94C",
      "accent_cool": "#6FCF97"
    },
    "type": { "sans": "Inter", "serif": "Source Serif" },
    "radius": "6px",
    "spacing_scale": 1.0
  },
  "locale": { "default": "en-IN", "supported": ["en-IN", "en-GB"] },
  "currency": { "code": "INR", "symbol": "₹", "rounding": "0.50" },
  "payments": { "providers": ["razorpay", "stripe"], "default": "razorpay" },
  "shipping": {
    "zones": [{ "code": "IN-metro", "rate_cents": 4900 }],
    "free_over_cents": 99900
  },
  "tax": { "mode": "inclusive", "default_rate": 0.18 },
  "homepage": {
    "blocks": [
      { "kind": "hero", "title": "Back to school", "cta": "Shop now", "banner_asset_id": "asset_b01" },
      { "kind": "featured-categories", "categories": ["notebooks", "pens", "art-supplies"] },
      { "kind": "product-grid", "collection": "new-arrivals", "limit": 12 }
    ]
  },
  "features": {
    "wishlist": true,
    "reviews": false,
    "guest_checkout": true,
    "b2b_pricing": false
  },
  "policies": {
    "returns_days": 7,
    "shipping_policy_page": "shipping-policy",
    "privacy_page": "privacy"
  }
}
```

## 10. UI Component Map

All components theme-aware via CSS custom properties from config. Headless primitives (Radix/shadcn) styled with Tailwind.

### 10.1 Storefront components

| Component | Purpose |
|---|---|
| `AppShell` | header + footer + nav, config-driven |
| `ProductCard` | image, name, price, badges, quick-add |
| `CategoryCard` | illustration + name + count |
| `ProductGallery` | main image + thumbnails, zoom |
| `VariantPicker` | axis-aware selectors (size, color, pack) |
| `PriceBlock` | compare-at + current + tax note |
| `AddToCartButton` | handles variant + quantity |
| `CartDrawer` | slide-over, line edit, subtotal |
| `CheckoutForm` | address, shipping, payment steps |
| `FilterSidebar` | faceted filters from attribute_definitions |
| `SearchBar` | typeahead, recent, suggestions |
| `OrderTimeline` | status stepper + tracking link |
| `CmsBlockRenderer` | dispatches to block registry |
| `WishlistButton` | feature-flagged |

### 10.2 Admin components

| Component | Purpose |
|---|---|
| `AdminSidebar` | section nav, permission-aware |
| `DataTable` | sortable, filterable, bulk-action, pagination |
| `ProductEditor` | tabs: basics, variants, media, SEO, inventory |
| `VariantMatrixEditor` | generates variants from axis combinations |
| `InventoryTable` | per-variant per-location stock + adjust |
| `OrderDetail` | items, payments, shipments, actions |
| `CmsPageBuilder` | block list + per-block form from schema |
| `MediaPicker` | browse assets, upload, insert |
| `PromotionEditor` | type-aware form, conditions, preview |
| `AnalyticsCard` | KPI tile with sparkline |
| `CsvImportWizard` | upload → map columns → dry-run → apply |
| `ThemeEditor` | live preview of tokens against storefront |

## 11. Admin Dashboard Layout

```
┌───────────────────────────────────────────────────────────────┐
│ Topbar: [store switcher] [search] [help] [user menu]          │
├──────────┬────────────────────────────────────────────────────┤
│          │                                                    │
│ Sidebar  │  Main                                              │
│          │  ┌───────────── KPI row ─────────────┐            │
│ Home     │  │ Sales │ Orders │ AOV │ Low stock │            │
│ Catalog  │  └───────────────────────────────────┘            │
│   Prods  │  ┌──── Recent orders ─────┐ ┌── Inventory ──┐    │
│   Cats   │  │ table                  │ │ low-stock list│    │
│   Bundl. │  └────────────────────────┘ └───────────────┘    │
│ Inventory│  ┌──── Traffic / conv. ───┐                      │
│ Orders   │  │ chart                  │                      │
│ Customers│  └────────────────────────┘                      │
│ Promos   │                                                    │
│ Content  │                                                    │
│ Analytics│                                                    │
│ Settings │                                                    │
│          │                                                    │
└──────────┴────────────────────────────────────────────────────┘
```

- Permission-keyed sections hidden for staff roles.
- "Settings" contains Config, Theme, Payments, Shipping, Tax, Users, Webhooks, Integrations.
- Workflows: CSV import wizard, variant matrix generator, stock adjustment flow, order refund flow, CMS page builder — all multi-step with save-draft.

## 12. Asset Generation Plan

### 12.1 Visual system

- **Palette:** primary `#2C3E8C`, secondary `#F2994A`, accent-warm `#F2C94C`, accent-cool `#6FCF97`, ink `#1A1A2E`, paper `#FAF6EE`.
- **Style:** minimal, playful, modern; 2px uniform stroke; rounded caps/joins; flat fills with optional 1-step shade; no gradients unless for banners.
- **Grid:** 24px icons on 2px stroke; illustrations on 12-col baseline.
- **Fonts:** Inter (UI/sans), Source Serif (accent); licensed via Google Fonts.

### 12.2 Asset inventory (71 items)

- **Logos (6):** wordmark, monogram, compact, dark-on-light, light-on-dark, favicon.
- **Category illustrations (8):** notebooks, pens, art, office, school, paper, bags, gifting.
- **Icons (40):** action (cart, heart, search, user, menu, close, chevrons…), product-attr (ruled, dotted, grid, gsm, ink-drop, tip-size…), trust (secure, return, truck, support), social (ig, yt, fb, x).
- **Banners (8):** hero landscape (desktop + mobile) for 4 seasonal campaigns.
- **Placeholders (6):** square, landscape, portrait variants of generic stationery line-art.
- **UI illustrations (3):** empty-cart, 404, success.

### 12.3 Pipeline

1. Design SVGs in Figma → export via SVGO.
2. CI generates `icons.svg` sprite with `<symbol>` per icon.
3. Upload raster banners/placeholders as master PNGs → derivative pipeline produces `avif`/`webp` at widths `320, 640, 1024, 1600`.
4. Assets registered in `assets` table with kind, dimensions, checksum; referenced by ID in CMS + config.

## 13. Deployment Architecture

### 13.1 Primary target — Render

- **Web service** — Next.js, auto-scale 1→N.
- **Worker service** — same image, `ROLE=worker`, BullMQ consumer.
- **Scheduler service** — same image, `ROLE=scheduler`, enqueues cron jobs.
- **Postgres** — Render Postgres (or Neon as alt) with PITR, daily backup.
- **Redis** — Render Redis / Upstash.
- **Object storage** — Cloudflare R2.
- **CDN / edge** — Cloudflare in front of Render web; custom domains mapped per store; TLS via Cloudflare.

### 13.2 Alternative targets

- **Vercel** — web only; worker/scheduler must move off (e.g., Railway/Fly); Postgres via Neon; viable for small stores.
- **AWS** — ECS Fargate for all three roles, RDS Postgres, ElastiCache Redis, S3, CloudFront; highest operational burden but best for scale.

### 13.3 Docker image

- Multi-stage: `deps → build → runtime`; `node:20-alpine` runtime; non-root user; health check at `/healthz`.
- One image, three entrypoints selected by `ROLE`: `web` → `next start`, `worker` → `node dist/worker.js`, `scheduler` → `node dist/scheduler.js`.

### 13.4 CI/CD

- GitHub Actions: `lint → typecheck → test → build → push image → deploy`.
- Drizzle migrations forward-only; a `migrate` job runs before web rollout.
- Preview environments per PR (ephemeral Render service + branch Postgres).
- Secrets via Render env groups; never committed.

### 13.5 Observability

- **Logs:** Pino JSON → Render log drain → Axiom/Logtail.
- **Metrics:** Prometheus `/metrics` endpoint scraped by Grafana Cloud.
- **Traces:** OpenTelemetry → Honeycomb/Tempo.
- **Errors:** Sentry (web + worker).
- **Uptime:** Cronitor / Better Stack probes on `/healthz` and synthetic checkout.

### 13.6 Environments

- `dev` (local Docker-Compose), `staging` (one-click branch deploy), `prod`.
- `.env.example` tracks every variable; typed `env.ts` parses + validates at boot.

## 14. Phase 7 — Future Scalability

Each item is scope-bounded to slot cleanly into the modular monolith without a rewrite:

- **POS integration** — new `pos` module + `locations.type='store'` already in schema; sync stock via existing `stock_movements`; hardware via WebSerial/WebUSB or thin local agent.
- **Supplier portal** — a second sub-app under `/portal`, read-only on `purchase_orders` + `supplier_skus`; supplier accounts in `users` with role `supplier`.
- **Wholesale / B2B pricing** — `customer_groups` + `price_lists` tables; `payment` module gates NET-terms; feature-flagged.
- **AI recommendations** — nightly vector embeddings of products (pgvector extension); `/api/v1/products/:id/similar`; widget on PDP.
- **Demand forecasting** — rollups from `stock_movements` + `orders` feeding an external forecast service or in-DB Prophet-lite; surfaces as suggested reorder qty in PO wizard.
- **Marketplace support** — additional tenant mode where `stores` nest under a root marketplace; payouts via Stripe Connect / Razorpay Route; seller role on `store_users`.

## 15. Non-Functional Targets

- **Performance:** p95 PDP < 300ms (SSR cached), p95 API < 150ms, LCP < 2.5s on 3G-fast.
- **Availability:** 99.9% web, 99.5% worker; graceful degradation for search/cms cache misses.
- **Data:** daily full backup + PITR 7 days; DR restore drill quarterly.
- **Security:** argon2id passwords, CSRF on admin mutations, strict CSP, HSTS, signed cookies, PII encrypted at rest, PCI scope minimized (tokenized via provider).
- **Accessibility:** WCAG 2.1 AA for storefront and admin; keyboard-first, focus-visible, prefers-reduced-motion.
- **Internationalization:** message catalogs per locale; currency + number formatting from config.

## 16. Open Questions & Defaults (assumed)

Defaults chosen to honor "do not ask unnecessary questions." Each is reversible.

| Topic | Default | Reversible by |
|---|---|---|
| Primary market | India (INR, GST inclusive) | site_config.locale/currency/tax |
| Payment providers | Razorpay + Stripe | payments module config |
| Host | Render | deployment doc + Docker image |
| Search | Postgres FTS + pg_trgm | swap to Meilisearch via search module |
| Image pipeline | imgproxy | swap to Cloudflare Images |
| ORM | Drizzle | — |
| Auth | Lucia-style sessions | — |
| Admin framework | shadcn/ui + Tailwind | — |

## 17. Acceptance Criteria for this Spec

- A developer can read this doc and know what to build and in what order.
- Every final deliverable listed in the original brief is addressed: architecture diagram (§3), DB schema (§5), API structure (§6), UI component map (§10), admin layout (§11), config structure (§9), asset plan (§12), deployment architecture (§13).
- The system is reusable across stationery stores through config + CMS + assets only — no code changes needed to launch a new store.
- Sub-projects (SP-1…SP-9) are small enough for individual implementation plans.

---

**Next step after user approval:** invoke `writing-plans` skill for **SP-1 — Foundation & tenancy**, then iterate sub-projects in the order given in §1.
