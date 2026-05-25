import { redis } from './redis';
import { env } from './env';
import { problem } from './errors';
import { NextResponse } from 'next/server';

/**
 * Redis-backed sliding-window rate limiter.
 *
 * Algorithm choice: a sorted-set sliding window (ZADD/ZREMRANGEBYSCORE/ZCARD)
 * rather than a fixed-window INCR+EXPIRE. The fixed window is cheaper but lets a
 * caller burst up to 2x the limit across a window boundary (the classic
 * "double-burst" problem). The sliding window keeps the count honest for the
 * trailing `windowSeconds` at all times, which matters for abuse protection on
 * checkout/auth endpoints. Each member is a unique score+suffix so concurrent
 * requests in the same millisecond don't collide.
 *
 * The whole read-modify-write runs in a MULTI so the count is consistent under
 * concurrency. Node-only (ioredis) — never import into Edge middleware.
 */

export type RateLimitResult = {
  allowed: boolean;
  /** Requests still available in the current window (>= 0). */
  remaining: number;
  /** Unix epoch milliseconds at which the window frees up the oldest hit. */
  resetAt: number;
  /** The configured ceiling, echoed for header construction. */
  limit: number;
};

export async function rateLimit(
  key: string,
  limit: number,
  windowSeconds: number,
): Promise<RateLimitResult> {
  const namespaced = `ratelimit:${key}`;
  const now = Date.now();
  const windowMs = windowSeconds * 1000;
  const windowStart = now - windowMs;
  // Unique member: timestamp plus a random suffix to survive same-ms bursts.
  const member = `${now}-${Math.random().toString(36).slice(2, 10)}`;

  const results = await redis
    .multi()
    .zremrangebyscore(namespaced, 0, windowStart) // drop hits older than the window
    .zadd(namespaced, now, member) // record this hit
    .zcard(namespaced) // count hits in the window (incl. this one)
    .zrange(namespaced, 0, 0, 'WITHSCORES') // oldest surviving hit, for resetAt
    .pexpire(namespaced, windowMs) // let idle keys expire on their own
    .exec();

  // `exec()` returns null only if the MULTI was discarded (e.g. WATCH abort);
  // we don't WATCH, so treat null as a transient failure and fail open.
  if (!results) {
    return { allowed: true, remaining: limit - 1, resetAt: now + windowMs, limit };
  }

  const countEntry = results[2];
  const oldestEntry = results[3];
  const count = typeof countEntry?.[1] === 'number' ? countEntry[1] : 0;

  let oldestScore = now;
  const oldestVal = oldestEntry?.[1];
  if (Array.isArray(oldestVal) && typeof oldestVal[1] === 'string') {
    oldestScore = Number(oldestVal[1]);
  }

  const allowed = count <= limit;
  const remaining = Math.max(0, limit - count);
  const resetAt = oldestScore + windowMs;

  return { allowed, remaining, resetAt, limit };
}

/**
 * Best-effort client IP. Trusts the standard proxy headers set by Render /
 * Cloudflare. Falls back to a constant so the limiter still functions (all
 * unidentifiable callers share one bucket) rather than silently disabling.
 */
export function clientIp(req: Request): string {
  const xff = req.headers.get('x-forwarded-for');
  if (xff) {
    const first = xff.split(',')[0]?.trim();
    if (first) return first;
  }
  return (
    req.headers.get('x-real-ip')?.trim() ??
    req.headers.get('cf-connecting-ip')?.trim() ??
    'unknown'
  );
}

export type WithRateLimitOptions = {
  /** Max requests per window. Defaults to env RATE_LIMIT_PER_MIN. */
  limit?: number;
  /** Window length in seconds. Defaults to 60. */
  windowSeconds?: number;
  /** Derives the bucket key from the request. Defaults to per-IP. */
  keyFn?: (req: Request) => string;
};

/**
 * Opt-in rate-limit wrapper for Node route handlers. Returns an RFC 7807 `429`
 * `NextResponse` (with `Retry-After` + `X-RateLimit-*` headers) when the caller
 * is over budget, or `null` when the request may proceed.
 *
 * Deliberately NOT applied globally: Edge middleware can't reach ioredis, and
 * forcing it on every route is wasteful. Call it at the top of handlers that
 * want protection, e.g. auth/checkout:
 *
 *   const limited = await withRateLimit(req, { limit: 10, windowSeconds: 60 });
 *   if (limited) return limited;
 */
export async function withRateLimit(
  req: Request,
  options: WithRateLimitOptions = {},
): Promise<NextResponse | null> {
  const limit = options.limit ?? env.RATE_LIMIT_PER_MIN;
  const windowSeconds = options.windowSeconds ?? 60;
  const key = options.keyFn ? options.keyFn(req) : `ip:${clientIp(req)}`;

  const result = await rateLimit(key, limit, windowSeconds);

  if (result.allowed) return null;

  const retryAfterSeconds = Math.max(1, Math.ceil((result.resetAt - Date.now()) / 1000));
  const res = problem(429, 'too-many-requests', 'Rate limit exceeded. Slow down and retry.');
  res.headers.set('Retry-After', String(retryAfterSeconds));
  res.headers.set('X-RateLimit-Limit', String(result.limit));
  res.headers.set('X-RateLimit-Remaining', String(result.remaining));
  res.headers.set('X-RateLimit-Reset', String(Math.ceil(result.resetAt / 1000)));
  return res;
}
