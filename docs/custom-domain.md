# Custom Domain Setup

How a tenant's domain (storefront + admin) is wired end-to-end:
Render → Cloudflare DNS → multi-tenant resolution in the app.

The same `web` service serves both the public storefront (`/`, `/p/...`,
`/c/...`, `/search`, `/cart`, `/checkout`, `/api/v1/...`) and the admin
UI (`/admin/...`) on whatever host the request arrives on. Tenancy is
resolved per-request from the `Host` header against the `store_domains`
table.

## 1. Add the domain in Render

1. Render dashboard → `ecommerce-web` → **Settings** → **Custom Domains**
   → **Add**.
2. Enter the apex (`example.com`) and `www` (`www.example.com`)
   separately. Render issues each its own certificate.
3. Render shows the target value to point DNS at — typically a Render
   `*.onrender.com` hostname for the CNAME, or a set of A/AAAA records
   for the apex (Render supports ALIAS-style flattening at some
   registrars).
4. The `worker` and `scheduler` services do not serve HTTP — they don't
   take a custom domain.

If you also expose admin on a subdomain (e.g. `admin.example.com`), add
that as a third custom domain on the same `web` service. The app routes
by path (`/admin`) regardless, but a subdomain helps cookie scoping and
CSP if you later split admin into its own service.

## 2. Cloudflare DNS

Assuming Cloudflare is the authoritative DNS for the apex.

1. Cloudflare → **DNS** → **Records**.
2. Apex: add a `CNAME` (or `A` if your registrar doesn't flatten) for
   `example.com` pointing at the Render target.
3. `www`: add a `CNAME` for `www.example.com` pointing at the same
   target.
4. Optionally `admin.example.com`: `CNAME` to the same target.

### Proxy on or off — the tradeoff

Cloudflare's orange-cloud proxy adds DDoS protection, edge caching, and
TLS termination at the edge. It also caches aggressively by default and
can mask Render's TLS posture.

Recommendation: **proxy OFF initially.** Reasons:

- The admin UI lives on the same hostname (and serves authenticated
  HTML). CF's default caching rules don't generally cache `Set-Cookie`
  responses, but a misconfigured Cache Rule can.
- Render already serves TLS + HTTP/2 with reasonable performance.
- Sentry, request-id correlation, and the rate limiter all expect the
  real client IP via `x-forwarded-for` / `cf-connecting-ip`. With proxy
  off you get `x-forwarded-for` from Render's LB; with proxy on you
  also get `cf-connecting-ip`, which `src/lib/rate-limit.ts#clientIp`
  already reads. Either works, but proxy-off is one fewer moving piece.

If you flip proxy ON later:

- Add a Cache Rule that bypasses cache on `/admin/*`, `/api/v1/*`,
  `Cookie:` header present, or non-GET methods.
- Cloudflare WAF rules can be useful in front of `/admin/login` for
  brute-force shaping, complementing the in-app rate limiter.
- Verify HSTS still gets through — CF respects upstream `Strict-Transport-Security`
  by default but a misconfigured "Always Use HTTPS" page rule can mask
  it.

## 3. HSTS and preload

The platform stamps `Strict-Transport-Security: max-age=63072000; includeSubDomains; preload`
on every response (see `src/middleware.ts` `SECURITY_HEADERS`). That
header alone is enough to opt into the modern HSTS behaviour.

Adding to the **HSTS preload list** (https://hstspreload.org/) is a
follow-up step, not automatic. Before submitting, verify:

- The apex AND every subdomain you intend to keep serve TLS — including
  any internal/staging that shares the apex. `includeSubDomains` is part
  of the policy.
- You're comfortable with the commitment: removing from the preload
  list is slow (months).
- The site has run on production HTTPS for at least a few weeks.

Submission is one-shot per apex. Do it from the
`hstspreload.org` form, not via DNS.

## 4. Per-tenant domains: how the platform resolves them

The architecture supports many tenants on one deployment. Each tenant
maps to one or more hostnames in `store_domains` (`src/db/schema/tenancy.ts`):

```
store_domains
  id          uuid
  store_id    uuid → stores.id
  domain      text (unique)
  is_primary  boolean
  created_at  timestamptz
```

Request flow:

1. `src/middleware.ts` reads `x-forwarded-host` / `host`, lowercases it,
   and stamps `x-store-host` on the request headers.
2. Route handlers and pages call `resolveTenant(host)` from
   `src/modules/tenant/resolve.ts`, which:
   - Looks up the host in Redis (`tenant:domain:<host>`, 10-min TTL).
   - Falls back to a SELECT against `store_domains` on miss.
   - Caches misses for 1 min as `__miss__` to avoid hammering the DB on
     unknown hosts.
3. Unknown host → handler returns `404 tenant-not-found` (RFC 7807).
4. The resolved `store_id` is `SET LOCAL app.store_id` for the request,
   gating every RLS-scoped read/write.

### Adding a new tenant domain

**Preferred (admin UI):** Admin → Settings → Domains → **Add domain**.
The form writes to `store_domains` under the correct `store_id`. Forward
reference — this UI may not exist yet; check the admin nav.

**Fallback (direct SQL):** run as the `app_migrator` role:

```sql
INSERT INTO store_domains (store_id, domain, is_primary)
VALUES (
  '<store-uuid>',
  'newtenant.example.com',
  true
);
```

Then invalidate the resolver cache so the next request sees the new
mapping immediately:

```ts
// scripts/invalidate-tenant.ts
import { invalidateTenantCache } from '@/modules/tenant/resolve';
await invalidateTenantCache('newtenant.example.com');
```

Or simply let the 10-min Redis TTL expire — most operators just wait.

### Adding the DNS for that tenant

Repeat steps 1 and 2 with `newtenant.example.com` instead of
`example.com`. Render must know about every hostname that hits the web
service, otherwise it returns its own cert-mismatch error before the
request reaches Next.js.

## 5. Verification checklist

After cutover:

- `curl -I https://example.com/healthz` → `200`, with `strict-transport-security`,
  `x-content-type-options: nosniff`, `referrer-policy`, and a fresh
  `x-request-id` header.
- `curl -I https://example.com/` resolves to the storefront layout.
- `curl -I https://example.com/admin/login` returns the admin login
  HTML (or a 302 to it). Not a 404.
- Sentry's `environment: production` events start to flow (if
  `SENTRY_DSN` is set).
- `/admin/metrics` shows non-zero `requests_total` after a few page
  views.
