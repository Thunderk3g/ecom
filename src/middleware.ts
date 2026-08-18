import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { recordRequest } from '@/lib/metrics';
import { withRateLimit } from '@/lib/rate-limit';
import { getSessionFromRequest } from '@/modules/auth/rbac';
import { mediaOrigins } from '@/modules/media/origins';
import { resolveTenant } from '@/modules/tenant/resolve';

// Runtime choice: this middleware runs on the Node runtime (Next.js 15
// supports `export const runtime = 'nodejs'` for middleware). prom-client and
// ioredis are node-only — they cannot be imported into the Edge bundle — so
// running here on Node is the cleanest single-point integration for metrics
// and admin rate limiting. The trade-off is slightly higher cold-start cost
// vs. the Edge runtime; that is acceptable since this is a regional Render
// deployment, not a globally-distributed Edge surface.
export const runtime = 'nodejs';

const REQUEST_ID_HEADER = 'x-request-id';
const REQUEST_START_HEADER = 'x-request-start';

// Per-admin-user rate limit applied here so we don't have to wrap every admin
// mutating endpoint individually. 600 req/min/admin matches SP-9 Task 15 —
// generous enough for bulk operations, tight enough to flag a runaway client.
const ADMIN_API_PREFIX = '/api/v1/admin';
const ADMIN_RATE_LIMIT = 600;
const ADMIN_RATE_WINDOW_SECONDS = 60;

// Next.js dev mode (react-refresh / HMR) evaluates code via `eval` and injects
// inline bootstrap scripts, so a strict `script-src 'self'` would break the dev
// server. We relax script-src with `unsafe-eval`/`unsafe-inline` ONLY in dev.
const DEV = process.env.NODE_ENV !== 'production';

/**
 * Per-request Content-Security-Policy. In production it is **nonce-based**: each
 * request gets a fresh nonce that is (a) injected into `script-src` here and
 * (b) propagated to Next.js via the request `Content-Security-Policy` header, so
 * Next stamps the same `nonce=` onto every inline bootstrap/hydration script it
 * emits. Without this the App Router's own inline scripts are blocked by
 * `script-src 'self'` and the page never hydrates.
 *
 * NOTE: we must NOT also include `'unsafe-inline'` in production — when a nonce
 * is present, CSP3 browsers IGNORE `'unsafe-inline'`. Dev keeps the relaxed
 * form (no nonce) so HMR's eval/inline scripts keep working.
 *
 * Deliberately conservative; individual routes may tighten/extend per-route.
 */
function buildSecurityHeaders(nonce: string | null): Record<string, string> {
  const scriptSrc =
    DEV || !nonce
      ? "script-src 'self' 'unsafe-eval' 'unsafe-inline'"
      : `script-src 'self' 'nonce-${nonce}'`;
  // Object storage the browser talks to directly: it PUTs upload bytes to a
  // signed URL (connect-src) and renders the stored objects (img-src). Without
  // these the direct-upload fetch fails as an opaque "Network error" and every
  // asset renders blank — a browser-only failure that server-side tests miss.
  const media = mediaOrigins().join(' ');
  const mediaSuffix = media ? ` ${media}` : '';

  // HMR websocket + dev overlay need ws:/wss: back to the dev server.
  const connectSrc = DEV
    ? `connect-src 'self' ws: wss:${mediaSuffix}`
    : `connect-src 'self'${mediaSuffix}`;

  const csp = [
    "default-src 'self'",
    "base-uri 'self'",
    "frame-ancestors 'none'",
    "object-src 'none'",
    `img-src 'self' data: blob:${mediaSuffix}`,
    "style-src 'self' 'unsafe-inline'",
    scriptSrc,
    connectSrc,
    "form-action 'self'",
  ].join('; ');

  return {
    'Strict-Transport-Security': 'max-age=63072000; includeSubDomains; preload',
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Content-Security-Policy': csp,
  };
}

/**
 * Templated route extraction for the metrics histogram label. Concrete UUIDs
 * and numeric segments are collapsed to `:id` so label cardinality stays bounded
 * (a `/api/v1/cart/<uuid>/items` request lands as `/api/v1/cart/:id/items`).
 */
function templatedRoute(pathname: string): string {
  return pathname
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, ':id')
    .replace(/\/\d+(?=\/|$)/g, '/:id');
}

export async function middleware(req: NextRequest): Promise<NextResponse> {
  const start = Date.now();
  const url = new URL(req.url);
  const host = (req.headers.get('x-forwarded-host') ?? req.headers.get('host') ?? '').toLowerCase();

  // Reuse an inbound request id (from a client or upstream LB) or mint one.
  const inbound = req.headers.get(REQUEST_ID_HEADER)?.trim();
  const requestId = inbound && inbound.length > 0 ? inbound : crypto.randomUUID();

  const requestHeaders = new Headers(req.headers);
  requestHeaders.set('x-store-host', host);
  requestHeaders.set(REQUEST_ID_HEADER, requestId);
  // Stamp the entry time so downstream handlers can compute a duration if they
  // want a more accurate per-handler observation than the middleware-exit one.
  requestHeaders.set(REQUEST_START_HEADER, String(start));

  // Per-request CSP nonce (production only). Propagating it to Next via the
  // request Content-Security-Policy header makes the App Router stamp the same
  // nonce onto its inline bootstrap/hydration scripts (otherwise `script-src
  // 'self'` blocks them and the page never hydrates). Also exposed as x-nonce
  // for any Server Component that renders its own inline <script>.
  const nonce = DEV ? null : Buffer.from(crypto.randomUUID()).toString('base64');
  const securityHeaders = buildSecurityHeaders(nonce);
  const cspValue = securityHeaders['Content-Security-Policy'];
  if (nonce && cspValue) {
    requestHeaders.set('x-nonce', nonce);
    requestHeaders.set('Content-Security-Policy', cspValue);
  }

  // Admin API rate limit: a single keyed bucket per (storeId, userId) so we
  // don't have to wrap each admin endpoint individually. Skip non-admin paths
  // and skip when we can't identify a session/store (those calls will fail
  // auth downstream — no point burning a rate-limit slot).
  if (url.pathname.startsWith(ADMIN_API_PREFIX)) {
    try {
      const storeId = host ? await resolveTenant(host) : null;
      const session = await getSessionFromRequest(req);
      if (storeId && session) {
        const limited = await withRateLimit(req, {
          limit: ADMIN_RATE_LIMIT,
          windowSeconds: ADMIN_RATE_WINDOW_SECONDS,
          keyFn: () => `admin:${storeId}:${session.userId}`,
        });
        if (limited) {
          // Stamp security + request-id on the 429 response too.
          limited.headers.set(REQUEST_ID_HEADER, requestId);
          for (const [k, v] of Object.entries(securityHeaders)) {
            limited.headers.set(k, v);
          }
          // Record the 429 in the metrics histogram before returning.
          recordRequest({
            method: req.method,
            route: templatedRoute(url.pathname),
            status: 429,
            durationSeconds: (Date.now() - start) / 1000,
          });
          return limited;
        }
      }
    } catch {
      // Rate limit must never break the request path — fail open. The error
      // would otherwise be observed via Sentry / pino in the route handler.
    }
  }

  const res = NextResponse.next({ request: { headers: requestHeaders } });

  // Echo the request id so clients can correlate, and stamp security headers.
  res.headers.set(REQUEST_ID_HEADER, requestId);
  res.headers.set('Server-Timing', `mw;dur=${Date.now() - start}`);
  for (const [key, value] of Object.entries(securityHeaders)) {
    res.headers.set(key, value);
  }

  // Record a metrics sample at middleware exit. The "status" here is 0 because
  // we don't have the final response status from `NextResponse.next()` — the
  // route handler runs after this returns. The histogram captures the
  // middleware-to-handover latency, which is a useful baseline; per-route
  // handlers can record a second, fuller observation if they care.
  // TODO(SP-9): once we have an HTTP-server-level afterResponse hook (Next.js
  // does not expose one in middleware today), switch to a single observation
  // with the real status code.
  recordRequest({
    method: req.method,
    route: templatedRoute(url.pathname),
    status: 0,
    durationSeconds: (Date.now() - start) / 1000,
  });

  return res;
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|healthz).*)'],
};
