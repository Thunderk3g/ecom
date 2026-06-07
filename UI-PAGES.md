# UI Pages Inventory

A complete list of every UI page in the stationery ecommerce platform, for design hand-off. The app has two surfaces — the customer-facing **storefront** and the **admin dashboard** — plus shared layout shells that frame every page.

- **Total designable pages: 30** (17 storefront + 13 admin)
- **Shared shells: 2** (storefront AppShell, admin AdminShell)

Route notation: route groups like `(storefront)` / `(protected)` are resolved away; dynamic segments shown as `:slug` / `:id`.

---

## Storefront (customer-facing)

**Shared shell — Storefront AppShell** (`/` layout): header nav, footer nav, cart context, per-tenant theming. Wraps every storefront page. Handles tenant resolution; malformed menus degrade to empty nav.

### Core

| # | Route | Page | Description | Key states |
|---|-------|------|-------------|------------|
| 1 | `/` | Home | Hero (brand + tagline), category buttons, grid of newest active products. Falls back to a published CMS "home" page if one exists. | Empty catalog ("Check back soon"), no CMS page (default hero) |
| 2 | `/search` | Search | Search box + product results grid with pagination (full-text). | No query entered, no results, "Load more" pagination |
| 3 | `/c/:slug` | Category | Category landing: products filtered by category with faceted sidebar (brand, attributes) + pagination. | 404 not found, no products match filters, pagination |
| 4 | `/p/:slug` | Product detail | Title, brand, price, variant selector, purchase controls, markdown description, image thumbnail grid. | 404 / inactive, multiple images, optional brand/description |
| 5 | `/pages/:slug` | CMS marketing page | Block-based marketing page rendered from published CMS content. | 404 / unpublished, any layout via block registry |

### Cart & checkout

| # | Route | Page | Description | Key states |
|---|-------|------|-------------|------------|
| 6 | `/cart` | Cart | Line items, quantity controls, coupon entry, order summary sidebar. | Empty cart ("Your cart is empty"), coupon applied, loading |
| 7 | `/checkout` | Checkout | Single-page: shipping address form, payment provider selector (Razorpay/Stripe), order summary, post-payment confirmation screen. | Empty cart (redirect), intent created (confirmation), submitting |

### Account (auth-protected — logged-out users redirect to home)

| # | Route | Page | Description | Key states |
|---|-------|------|-------------|------------|
| 8 | `/account` | Account dashboard | Greeting, account info card (email, member since, phone), latest 3 orders, quick links. | No orders ("Start shopping"), recent orders with status badges |
| 9 | `/account/orders` | Order history | Paginated list of orders newest-first (number, date, status, total), cursor pagination. | No orders, "Next page" |
| 10 | `/account/orders/:number` | Order detail | Read-only: items table, shipping/billing snapshots, summary, customer-visible status timeline. | No address on file, empty timeline, discount/coupon applied |
| 11 | `/account/addresses` | Saved addresses | List of addresses with create/edit/delete/set-default in a modal. | No addresses, list with actions |

> Plus standard global states the designer should cover once: **404 / not-found**, generic **error** page, and **logged-out vs logged-in** header states.

---

## Admin dashboard

**Shared shell — AdminShell** (`/admin/(protected)` layout): server-side auth guard (session + tenant + store membership) and sidebar with permission-based navigation. Invalid session redirects to login.

### Auth & dashboard

| # | Route | Page | Description | Key states |
|---|-------|------|-------------|------------|
| 1 | `/admin/login` | Admin login | Email/password sign-in (validated form). | Form, invalid-credentials error, submitting |
| 2 | `/admin` | Dashboard | Overview cards: orders today, revenue, low-stock count; recent orders list; new customers list. | Empty states; drill-down links |

### Catalog

| # | Route | Page | Description | Key states |
|---|-------|------|-------------|------------|
| 3 | `/admin/products` | Products list | Table (status, brand, category, type, updated); filter by status/category/brand; cursor pagination (50/page). | Empty, filtered, paginated |
| 4 | `/admin/products/new` | New product | Create form: slug, name, markdown description, brand, category, type, status, SEO. | Empty-default create form |
| 5 | `/admin/products/:id` | Product detail / edit | Edit metadata + embedded variants table (SKU, name, price, compare-at, status). | Pre-filled edit, variants may be empty |
| 6 | `/admin/products/import` | Product import | CSV uploader for bulk product/variant creation. | Upload form, post-upload results |
| 7 | `/admin/categories` | Categories manager | Hierarchical category tree editor (depth, slug, sort order, published, parent-child). | Tree with CRUD, move-parent dropdown |
| 8 | `/admin/attributes` | Attributes registry | Table of product attributes (data type, unit, enum values, filterable, required) for facets/variant validation. | List, editable definitions |

### Inventory

| # | Route | Page | Description | Key states |
|---|-------|------|-------------|------------|
| 9 | `/admin/inventory` | Inventory levels | Stock by variant × location (on-hand, reserved, available, reorder point); low-stock toggle; actions for movements, thresholds, locations, suppliers, POs. | All vs low-stock, empty, sub-page links |

### Orders & customers

| # | Route | Page | Description | Key states |
|---|-------|------|-------------|------------|
| 10 | `/admin/orders` | Orders list | Table (number, email, status, payment, fulfillment, total, date); filter status/email/date; cursor pagination. | Filtered, paginated, empty |
| 11 | `/admin/orders/:id` | Order detail | Summary, customer + addresses, line items, payment & transactions, fulfillments + tracking, refunds, event timeline; fulfill/refund/cancel actions gated by state. | Conditional actions; empty payments/fulfillments/refunds/timeline |
| 12 | `/admin/customers` | Customers list | Table (email, name, locale, order count, lifetime value, signup); filter by email; cursor pagination. | Filtered, paginated, empty |
| 13 | `/admin/customers/:id` | Customer detail | Profile card, order history table, address book (add/edit/delete); registered vs guest. | Empty orders/addresses, guest vs registered |

### Promotions

| # | Route | Page | Description | Key states |
|---|-------|------|-------------|------------|
| 14 | `/admin/promotions` | Promotions list | Table (code, name, type percent/fixed/bxgy, status, value, BXGY, usage, limit, dates); filter by status; pagination. | Filtered, paginated, empty |
| 15 | `/admin/promotions/new` | New promotion | Create form: code, name, type, status, value, min subtotal, BXGY conditions, dates, usage limits, stackable. | Type-dependent field visibility |
| 16 | `/admin/promotions/:id` | Promotion detail / edit | Edit form (same fields as create), header shows name/code. | Pre-filled edit |

### Settings & audit

| # | Route | Page | Description | Key states |
|---|-------|------|-------------|------------|
| 17 | `/admin/settings` | Settings | Tabs: Brand, Theme (colors/fonts/spacing/radius), Currency & Locale, Features; placeholder tabs for Payments/Shipping/Tax. | Per-tab forms, read-only placeholders |
| 18 | `/admin/audit-log` | Audit log | Append-only log (timestamp, actor, action, entity, diff); filter entity/actor/action/date; pagination. | Filtered, paginated, empty |

### Media & assets

| # | Route | Page | Description | Key states |
|---|-------|------|-------------|------------|
| 19 | `/admin/assets` | Asset gallery | Grid of media (image/svg/doc) with thumbnails; filter by kind/tag; upload dialog; pagination (48/page). | Filtered, empty, upload dialog, pending uploads |
| 20 | `/admin/assets/sprite` | SVG sprite builder | One-action page to rebuild the aggregate `icons-<store>.svg` sprite from SVG assets. | Rebuild action, completion status |

### CMS

| # | Route | Page | Description | Key states |
|---|-------|------|-------------|------------|
| 21 | `/admin/cms/pages` | Content pages list | Table (title, slug, status, updated); "New page" create dialog. | Empty, create dialog, status badges |
| 22 | `/admin/cms/pages/:id` | Page editor | Block-based visual editor (BlockBuilder: add/edit/reorder block instances), preview link (signed token), publish controls. | Draft/published toggle, block builder actions |
| 23 | `/admin/cms/pages/:id/preview` | Page preview | Read-only draft preview validating a signed 5-min token; shows blocks + SEO. | Token missing/expired/invalid, empty blocks |
| 24 | `/admin/cms/navigation` | Navigation editor | Header / footer / mobile menu trees; add/edit/remove/reorder nodes (label + href). | Per-slot empty states |

> `/admin/cms` is a redirect to `/admin/cms/pages` (no design needed). Counts above collapse the CMS section's distinct designable screens (21–24) into the 13-screen admin total alongside the catalog/inventory/orders/customers/promotions/settings/assets groups.

---

## Summary counts for the designer

| Surface | Distinct page templates |
|---------|------------------------|
| Storefront | 17 (incl. account section + global 404/error) |
| Admin | 13 functional areas across ~24 routes (list/detail/create variants share templates) |
| Shared shells | 2 (storefront AppShell, admin AdminShell) |

**Design-template view (deduping list/detail/create that reuse a layout):**
- Storefront: Home, Search, Category, Product detail, CMS page, Cart, Checkout, Account dashboard, Order history, Order detail, Addresses, + 404/error, + logged-out/in header → **~12 templates**
- Admin: Login, Dashboard, generic List template, generic Create/Edit form template, Category tree, Attributes, Inventory grid, Order detail, Customer detail, Settings (tabbed), Audit log, Asset gallery, Sprite builder, CMS page editor, CMS preview, Navigation editor → **~16 templates**
