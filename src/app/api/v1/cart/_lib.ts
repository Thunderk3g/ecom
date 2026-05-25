/**
 * Shared helpers for SP-4 storefront cart routes (Stream E).
 *
 * The storefront pipeline differs from the admin pipeline in three ways:
 *
 *   1. **Tenant resolution** is identical (resolveTenant → 404 on miss).
 *   2. **No RBAC.** Storefront endpoints serve customers, not admin users.
 *   3. **Anonymous session.** Carts are anchored to a `cart_sid` cookie
 *      (signed, 30-day lifetime) rather than to an authenticated user. If
 *      the customer logs in later, the `/cart/:id/merge` endpoint joins the
 *      guest cart into the customer's cart. The signed user-session cookie
 *      (`sid`) is read opportunistically — when present we link the cart's
 *      `customerId` to `session.userId`.
 *
 * CSRF is enforced against whichever session id is in scope for the request:
 *   - Logged-in:  use the user-session id (`sid`).
 *   - Guest:      use the cart-session id (`cart_sid`).
 *
 * Mutations also require an `Idempotency-Key` header per the global
 * convention (CLAUDE.md). The header value is passed to `withIdempotency`
 * inside each route so a repeated POST/PATCH/DELETE returns the cached
 * response from Redis instead of double-applying.
 */

import crypto from 'node:crypto';
import { NextResponse } from 'next/server';
import { resolveTenant } from '@/modules/tenant/resolve';
import { getSessionFromRequest, type Session } from '@/modules/auth/rbac';
import { requireCsrf } from '@/modules/auth/csrf';
import { sign, unsign } from '@/lib/cookies';
import { env } from '@/lib/env';
import { problem } from '@/lib/errors';
import {
  CartError,
  CartItemNotFoundError,
  CartNotFoundError,
  CouponExpiredError,
  CouponUsageExhaustedError,
  EmptyCartError,
  InvalidCouponError,
  MissingShippingAddressError,
  VariantNotAvailableError,
} from '@/modules/cart/errors';

// ──────────────────────────────────────────────────────────────────────────────
// Cookie naming + options
// ──────────────────────────────────────────────────────────────────────────────
// Per plan §Risks #8: 30-day lifetime, http-only, SameSite=Lax. Refreshed on
// every cart mutation (the route writes a new `Set-Cookie` header).

export const CART_SID_COOKIE = 'cart_sid';

export const cartSidCookieOptions = {
  httpOnly: true,
  secure: env.NODE_ENV === 'production',
  sameSite: 'lax' as const,
  path: '/',
  domain: env.COOKIE_DOMAIN,
  maxAge: 60 * 60 * 24 * 30,
};

function parseCookieHeader(header: string | null): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const piece of header.split(';')) {
    const eq = piece.indexOf('=');
    if (eq < 0) continue;
    const k = piece.slice(0, eq).trim();
    const v = piece.slice(eq + 1).trim();
    if (k) out[k] = decodeURIComponent(v);
  }
  return out;
}

function mintGuestSessionId(): string {
  return crypto.randomBytes(32).toString('hex');
}

// ──────────────────────────────────────────────────────────────────────────────
// Storefront context resolution
// ──────────────────────────────────────────────────────────────────────────────

export type StorefrontContext = {
  storeId: string;
  /** Storefront session id (guest cart_sid or, when present, the user session id). */
  sessionId: string;
  /** Cookie value to set on the response (signed cart_sid). Always set so the cookie is refreshed/rolling. */
  cartSidCookieValue: string;
  /** True when we just minted a new cart_sid (no previous cookie). */
  freshCartSid: boolean;
  /** The authenticated user session, if any. `customerId` for the cart is `userSession.userId`. */
  userSession: Session | null;
};

/**
 * Resolve the standard storefront preamble:
 *   - tenant (404 on miss)
 *   - cart_sid cookie (minted if absent)
 *   - opportunistic user session (cart.customerId target)
 *
 * Always returns a context — there's no preceding auth requirement on
 * storefront cart routes. Routes that need a logged-in customer (e.g. merge,
 * customer order list) must additionally check `ctx.userSession`.
 */
export async function resolveStorefrontContext(
  req: Request,
): Promise<{ ok: true; ctx: StorefrontContext } | { ok: false; response: NextResponse }> {
  const host = req.headers.get('x-store-host') ?? req.headers.get('host') ?? '';
  const storeId = host ? await resolveTenant(host) : null;
  if (!storeId) {
    return { ok: false, response: problem(404, 'tenant-not-found', 'Unknown host', []) };
  }

  const cookies = parseCookieHeader(req.headers.get('cookie'));
  const signedCartSid = cookies[CART_SID_COOKIE];
  let cartSessionId: string | null = signedCartSid ? unsign(signedCartSid) : null;
  let freshCartSid = false;
  if (!cartSessionId) {
    cartSessionId = mintGuestSessionId();
    freshCartSid = true;
  }

  const userSession = await getSessionFromRequest(req);

  return {
    ok: true,
    ctx: {
      storeId,
      sessionId: userSession ? userSession.id : cartSessionId,
      cartSidCookieValue: sign(cartSessionId),
      freshCartSid,
      userSession,
    },
  };
}

/**
 * Apply the rolling cart_sid cookie to a NextResponse. Called by every
 * route that participates in cart flow so the cookie refreshes on
 * activity (and is set on the very first GET/POST).
 */
export function attachCartSidCookie(res: NextResponse, ctx: StorefrontContext): NextResponse {
  res.cookies.set(CART_SID_COOKIE, ctx.cartSidCookieValue, cartSidCookieOptions);
  return res;
}

// ──────────────────────────────────────────────────────────────────────────────
// Mutation gate: CSRF + Idempotency-Key
// ──────────────────────────────────────────────────────────────────────────────

export type MutationGateResult =
  | { ok: true; idempotencyKey: string }
  | { ok: false; response: NextResponse };

/**
 * Enforce CSRF token + Idempotency-Key for cart/checkout mutations. CSRF is
 * checked against `ctx.sessionId` (either the user session id or the guest
 * cart_sid). Idempotency-Key is required per CLAUDE.md.
 */
export function requireMutationGate(req: Request, ctx: StorefrontContext): MutationGateResult {
  if (!requireCsrf(req, ctx.sessionId)) {
    return {
      ok: false,
      response: problem(403, 'csrf-invalid', 'CSRF token missing or invalid', []),
    };
  }
  const idempotencyKey = req.headers.get('idempotency-key');
  if (!idempotencyKey) {
    return {
      ok: false,
      response: problem(400, 'idempotency-key-required', 'Idempotency-Key header is required', [
        { path: ['idempotency-key'], message: 'required' },
      ]),
    };
  }
  return { ok: true, idempotencyKey };
}

// ──────────────────────────────────────────────────────────────────────────────
// Ownership check
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Verify the cart belongs to the current storefront caller.
 *   - Logged-in: cart.customerId === userSession.userId.
 *   - Guest:     cart.sessionId  === ctx.sessionId AND cart.customerId === null.
 *
 * Returns false on mismatch so the caller can 404 (we never reveal the
 * existence of carts that belong to other browsers).
 */
export function cartIsOwnedBy(
  cart: { sessionId: string; customerId: string | null },
  ctx: StorefrontContext,
): boolean {
  if (ctx.userSession) {
    return cart.customerId === ctx.userSession.userId;
  }
  return cart.sessionId === ctx.sessionId && cart.customerId === null;
}

// ──────────────────────────────────────────────────────────────────────────────
// JSON body parser
// ──────────────────────────────────────────────────────────────────────────────

export async function readJsonBody(
  req: Request,
): Promise<{ ok: true; data: unknown } | { ok: false; response: NextResponse }> {
  try {
    const data = (await req.json()) as unknown;
    return { ok: true, data };
  } catch {
    return {
      ok: false,
      response: problem(400, 'invalid-json', 'Request body must be valid JSON', []),
    };
  }
}

// ──────────────────────────────────────────────────────────────────────────────
// Error mapping for cart-domain errors
// ──────────────────────────────────────────────────────────────────────────────

export function mapCartError(err: unknown): NextResponse {
  if (err instanceof CartNotFoundError) {
    return problem(404, 'cart-not-found', err.message, []);
  }
  if (err instanceof CartItemNotFoundError) {
    return problem(404, 'cart-item-not-found', err.message, []);
  }
  if (err instanceof VariantNotAvailableError) {
    return problem(422, 'variant-not-available', err.message, [
      { path: ['variantId'], message: err.reason ?? 'not available' },
    ]);
  }
  if (err instanceof InvalidCouponError) {
    return problem(422, 'invalid-coupon', err.message, [
      { path: ['code'], message: 'invalid' },
    ]);
  }
  if (err instanceof CouponExpiredError) {
    return problem(409, 'coupon-expired', err.message, [
      { path: ['code'], message: 'expired' },
    ]);
  }
  if (err instanceof CouponUsageExhaustedError) {
    return problem(409, 'coupon-usage-exhausted', err.message, [
      { path: ['code'], message: 'usage exhausted' },
    ]);
  }
  if (err instanceof EmptyCartError) {
    return problem(409, 'cart-empty', err.message, []);
  }
  if (err instanceof MissingShippingAddressError) {
    return problem(409, 'missing-shipping-address', err.message, [
      { path: ['shippingAddress'], message: 'required' },
    ]);
  }
  if (err instanceof CartError) {
    return problem(400, 'cart-error', err.message, []);
  }
  return problem(500, 'internal-error', 'Internal server error', []);
}
