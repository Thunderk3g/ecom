import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

// NOTE: this file runs on the Next.js *Edge* runtime. It must NOT import
// node-only libraries (ioredis, pino, prom-client). Keep it to header
// manipulation only. Rate limiting and metrics live in Node helpers that
// route handlers call directly (see src/lib/rate-limit.ts, src/lib/metrics.ts).

const REQUEST_ID_HEADER = 'x-request-id';

/**
 * Baseline Content-Security-Policy. Deliberately conservative; individual
 * routes (storefront pages that load remote images, embed payment SDKs, etc.)
 * tighten or extend this per-route via their own response headers. This default
 * is the floor applied to everything the matcher covers.
 */
const BASELINE_CSP = [
  "default-src 'self'",
  "base-uri 'self'",
  "frame-ancestors 'none'",
  "object-src 'none'",
  "img-src 'self' data: blob:",
  "style-src 'self' 'unsafe-inline'",
  "script-src 'self'",
  "connect-src 'self'",
  "form-action 'self'",
].join('; ');

const SECURITY_HEADERS: Record<string, string> = {
  'Strict-Transport-Security': 'max-age=63072000; includeSubDomains; preload',
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Content-Security-Policy': BASELINE_CSP,
};

export function middleware(req: NextRequest) {
  const host = (req.headers.get('x-forwarded-host') ?? req.headers.get('host') ?? '').toLowerCase();

  // Reuse an inbound request id (from a client or upstream LB) or mint one.
  // crypto.randomUUID is available on the Edge runtime.
  const inbound = req.headers.get(REQUEST_ID_HEADER)?.trim();
  const requestId = inbound && inbound.length > 0 ? inbound : crypto.randomUUID();

  const requestHeaders = new Headers(req.headers);
  requestHeaders.set('x-store-host', host);
  requestHeaders.set(REQUEST_ID_HEADER, requestId);

  const res = NextResponse.next({ request: { headers: requestHeaders } });

  // Echo the request id so clients can correlate, and stamp security headers.
  res.headers.set(REQUEST_ID_HEADER, requestId);
  for (const [key, value] of Object.entries(SECURITY_HEADERS)) {
    res.headers.set(key, value);
  }

  return res;
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|healthz).*)'],
};
