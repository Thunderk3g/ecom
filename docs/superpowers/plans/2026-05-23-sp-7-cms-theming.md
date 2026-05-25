# SP-7: CMS & Theming — Implementation Plan

> Use superpowers:subagent-driven-development. **Note:** UI tasks need browser verification.

**Goal:** Build the storefront UI: home, category listing, product detail, cart drawer, checkout, account, search, CMS pages. Implement CMS with versioned pages, block registry, draft/publish, navigation menus per slot, and the theme token pipeline (already partially in SP-1). Storefront is SSR/ISR with revalidation tags so admin publishes invalidate the right caches.

---

## Scope

**Schemas (extending SP-1's tables):**
- `content_pages` (id, store_id, slug, title, status, published_version_id, draft_version_id, created_at)
- `content_versions` (id, page_id, blocks jsonb, seo jsonb, created_by, created_at)
- `content_blocks_lib` (id, store_id, key, kind, schema jsonb) — block definitions for admin form rendering
- `navigation_menus` (id, store_id, slot, items jsonb)

**Storefront pages (under `src/app/(storefront)/`):**
- `page.tsx` — home (renders the homepage CMS page)
- `c/[slug]/page.tsx` — category listing with facets
- `p/[slug]/page.tsx` — product detail
- `search/page.tsx` — search results
- `cart/page.tsx` — full cart view
- `checkout/page.tsx` — checkout flow
- `account/page.tsx` — customer dashboard
- `account/orders/page.tsx` — order list + detail
- `account/addresses/page.tsx` — saved addresses
- `pages/[slug]/page.tsx` — CMS-rendered marketing page (about, FAQ, etc.)

**Block registry** — render dispatch:
- hero — title, subtitle, CTA, banner image
- featured-categories — array of category slugs → category cards
- product-grid — collection slug or product ids, limit, layout
- banner — full-width image + optional text overlay
- rich-text — markdown content
- testimonials — quotes + names
- newsletter — email capture form
- two-column — split content into left/right slots

**Admin CMS pages (under `src/app/admin/cms/`):**
- `pages/list` — list of content pages
- `pages/[id]/edit` — block builder: drag-reorder, per-block form (zod schema from `content_blocks_lib.schema`)
- `pages/[id]/preview` — signed preview URL that renders the draft version
- `pages/[id]/publish` — POST to flip published_version_id to draft_version_id
- `navigation/[slot]/edit` — tree editor for header/footer/mobile menu

**Theme:**
- Color picker UI in admin settings → writes to `site_config.theme.color` (already injected at SSR)
- Font picker (Inter / Source Serif / custom)
- Spacing scale, radius, button style

**Cache invalidation:**
- On page publish: `revalidateTag(\`cms-page:\${slug}\`)` and `revalidatePath('/pages/\${slug}')`
- On site_config update: `revalidateTag('site-config:\${storeId}')`
- On product publish: `revalidateTag('product:\${slug}')` and category tag

---

## Tasks (high-level)

1. Schemas + migration 0019_cms
2. RLS for content tables
3. content_pages + content_versions module
4. content_blocks_lib seeded with default block schemas
5. navigation_menus module
6. Block registry + dispatcher (server component)
7. AppShell storefront component (uses navigation_menus + site_config)
8. Homepage rendering
9. Category listing with FilterSidebar (uses computeFacets from SP-2)
10. Product detail with VariantPicker + AddToCartButton
11. Search page with typeahead
12. Cart page + drawer
13. Checkout flow (3-step or single-page configurable)
14. Account section
15. CMS pages list + editor in admin
16. Block builder (drag-drop)
17. Preview signed URL
18. Publish action
19. Navigation editor in admin
20. Theme settings UI
21. Revalidation hooks on publish/config-update
22. Sitemap generator (scheduled job) — writes /sitemap.xml from published pages + products
23. Tests: E2E with Playwright for browse → add → checkout flow

---

## Parallel Streams

- A: schemas + migration (sequential)
- B: CMS modules + block registry (after A)
- C: Storefront layout + pages (after B)
- D: Admin CMS editor (after B, parallel to C)
- E: Revalidation + sitemap (after C+D)
- F: Tests

**UI streams (C, D) require browser verification — run in foreground.**

---

## Risks

1. **i18n:** v1 single-language. content_versions could carry `locale` for future multi-locale.
2. **Block schema migrations:** when a block definition changes, existing rendered pages may break. v1: validate on render and skip broken blocks with a warning log.
3. **Cache stampede on heavy CMS pages:** mitigate with `unstable_cache` + revalidate tags.
4. **Preview security:** signed URL must include short TTL (5 min) and bind to page version id, not just page id.
