# SP-6: Admin Dashboard — Implementation Plan

> Use superpowers:subagent-driven-development to implement task-by-task. **Note:** UI tasks require browser verification per CLAUDE.md — prefer foreground execution with manual visual checks.

**Goal:** Build the `/admin` Next.js UI on top of the admin REST APIs from SP-2/SP-3/SP-4/SP-5. Provide tables, editors, and bulk operations for products, variants, categories, inventory, orders, customers, promotions, CMS pages, assets, and settings. Add CSV import processor (consumes the queue that SP-2 stubbed). Wire shadcn/ui + Tailwind theme. Surface RBAC: routes redirect on missing role/permission.

**Architecture:** App Router pages under `src/app/admin/`. Server components fetch via direct module calls (faster than HTTP round-trip). Client components handle interactivity (forms, drag-drop, optimistic updates). Server Actions handle mutations (admin actions don't need a public REST endpoint for the UI; the existing `/api/v1/admin/...` routes remain for programmatic access). RBAC checked in `src/app/admin/layout.tsx` and again in every Server Action.

**Tech additions:**
- shadcn/ui components — install via the official CLI (DataTable, Form, Dialog, Toast, etc.)
- `@tanstack/react-table` — for sortable/filterable data tables
- `papaparse` — CSV parsing in the worker
- `react-hook-form` + `@hookform/resolvers/zod` — form state

---

## Scope

Pages:
- `/admin` — dashboard (today's orders, low stock, recent customers)
- `/admin/products` — list + filters + bulk actions
- `/admin/products/new` — multi-tab editor (basics, variants matrix, media, SEO)
- `/admin/products/[id]` — same editor in edit mode
- `/admin/products/import` — CSV upload, progress, error report
- `/admin/categories` — tree editor with drag-reorder
- `/admin/attributes` — registry editor
- `/admin/inventory/levels` — variant × location grid with inline adjust
- `/admin/inventory/movements` — paginated ledger view
- `/admin/inventory/locations` — CRUD
- `/admin/inventory/suppliers` — CRUD + per-supplier SKU mapping
- `/admin/inventory/purchase-orders` — list + create + receive flow
- `/admin/inventory/thresholds` — bulk edit reorder points
- `/admin/orders` — list + filters
- `/admin/orders/[id]` — detail with timeline, fulfillment, refund actions
- `/admin/customers` — list + detail
- `/admin/promotions` — list + create
- `/admin/cms/pages` — list (placeholder; full builder in SP-7)
- `/admin/assets` — gallery + upload (placeholder; full pipeline in SP-8)
- `/admin/settings` — site_config editor: brand, theme, payments, shipping, tax, features
- `/admin/audit-log` — paginated event view
- `/admin/login` — login form using SP-1's `/api/v1/auth/login`

Components (shared):
- `AdminShell` — sidebar + topbar
- `DataTable` — wraps tanstack table
- `FormSection` — labeled section in form
- `MoneyInput` — accepts decimal, persists cents
- `AddressForm` — country/region/postal validation
- `ImagePicker` — accepts asset_id (stub picker until SP-8)
- `Toast` — shadcn toast
- `ConfirmDialog` — destructive action confirmation

---

## Tasks

### Task 1 — Tailwind + shadcn install

`pnpm dlx shadcn-ui@latest init`. Configure theme tokens via CSS custom properties — already injected at SSR by SP-1. Add base components: button, card, dialog, dropdown-menu, form, input, label, popover, select, separator, sheet, switch, table, tabs, textarea, toast.

### Task 2 — Admin layout + auth guard

`src/app/admin/layout.tsx`: redirect to /admin/login if no session; resolve tenant; render `AdminShell`. Use `getSession()` + `requireStorePermission()` server-side.

### Task 3 — Dashboard

`src/app/admin/page.tsx`. Server component. Fetches today's order count, low-stock variants, recent customer signups via direct module calls.

### Tasks 4–7 — Products section

List page with DataTable, filters (status, category, brand). Editor with tabs. Variant matrix (axes editor + generated table). CSV import page with progress.

### Task 8 — Categories tree editor

Drag-and-drop reorder (use `@dnd-kit/sortable`). Server Action `reorderCategories` persists the new tree.

### Tasks 9–14 — Inventory section

Levels grid: server-fetched variants × locations join, inline adjust dialog. Movements ledger paginated. Locations CRUD. Suppliers + SKUs. Purchase orders list, create, receive flow with item-by-item qty inputs.

### Task 15 — Orders section

List with status filter chips. Detail page: timeline (order_events), items table, fulfill modal (qty per item, carrier, tracking), refund modal (partial-by-item or full), cancel button (with reason).

### Task 16 — Customers section

List, detail with order history, address book.

### Task 17 — Promotions section

List + create form. Type-aware form (percent/amount/free_ship/bxgy show different fields).

### Task 18 — Settings

Tabs for: Brand, Theme (color pickers feeding CSS vars preview), Payments (provider selection + key entry), Shipping (zones + rates editor), Tax (rates editor), Features (toggles). Persists to site_config.

### Task 19 — Audit log

Paginated view of `audit_log` table (SP-5). Filter by entity_type / actor.

### Task 20 — CSV import processor

`src/queue/jobs/csv-import.ts` — consumes `csv.imports` queue. Streams the uploaded file (stored temporarily in `/tmp` or R2 stub), validates each row with zod, upserts products/variants. Returns import_results jsonb (`{ rowCount, errors: [{row, message}] }`) accessible via admin page.

### Task 21 — Tests

- Server Action smoke tests
- Component snapshot tests for DataTable, FormSection
- E2E with Playwright for: login → dashboard → create product → list shows it → delete

---

## Parallel Stream Groupings

UI work has heavy shared layout dependencies (AdminShell). Run sequentially through Task 2, then parallelize section pages.

- A: Tailwind + shadcn + layout (Tasks 1, 2)
- B: Products section (Tasks 3–7)
- C: Inventory section (Tasks 9–14)
- D: Orders section (Tasks 15)
- E: Customers section (Task 16)
- F: Promotions + settings + audit (Tasks 17, 18, 19)
- G: CSV import processor (Task 20)
- H: Tests (Task 21, final)

**Important constraint:** UI work needs visual verification — run in foreground with `pnpm dev` open in a browser, not background agents.

## Risks & Open Questions

1. **Form complexity:** product editor with variants is complex. Consider react-hook-form + zod with `useFieldArray`.
2. **Bulk edit:** v1 supports bulk publish/archive. Bulk price change is admin-import-only.
3. **CSV column conventions:** documented in `/admin/products/import` page; matches the platform's own export format.
4. **Mobile admin:** v1 is desktop-first. Mobile responsiveness deferred.
