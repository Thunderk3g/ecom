'use server';

import crypto from 'node:crypto';
import { cookies } from 'next/headers';
import { sign, unsign, SESSION_COOKIE } from '@/lib/cookies';
import { mintCsrfToken } from '@/modules/auth/csrf';
import { validateSession } from '@/modules/auth/session';
import { env } from '@/lib/env';

/**
 * Storefront session bootstrap (Server Action).
 *
 * The cart/checkout HTTP API (`/api/v1/cart/*`, `/api/v1/checkout/*`) enforces
 * CSRF by HMAC-ing a token against the caller's *session id* — which is the
 * logged-in user-session id (`sid`) when present, otherwise the unsigned guest
 * `cart_sid` value. Both cookies are http-only and signed, so a browser cannot
 * derive a valid token on its own.
 *
 * This action runs on the server where it CAN read those cookies and (for
 * guests) mint + set the `cart_sid` cookie, then returns a CSRF token bound to
 * the exact session id the API will verify against. The client cart context
 * calls it once on mount and sends the token in the `x-csrf-token` header on
 * every mutation. It does NOT touch any API route.
 *
 * Cookie options mirror `src/app/api/v1/cart/_lib.ts` so the value the API
 * later rolls is byte-compatible with what we set here.
 */

const CART_SID_COOKIE = 'cart_sid';

function mintGuestSessionId(): string {
  return crypto.randomBytes(32).toString('hex');
}

export type StorefrontSession = {
  /** A CSRF token valid for this session id; send as `x-csrf-token`. */
  csrfToken: string;
  /** True when the caller is an authenticated customer (sid cookie present). */
  authenticated: boolean;
};

export async function ensureStorefrontSession(): Promise<StorefrontSession> {
  const jar = await cookies();

  // 1. Prefer the authenticated user session id when the sid cookie validates.
  const signedSid = jar.get(SESSION_COOKIE)?.value;
  if (signedSid) {
    const sessionId = unsign(signedSid);
    if (sessionId) {
      const row = await validateSession(sessionId);
      if (row) {
        return { csrfToken: mintCsrfToken(sessionId), authenticated: true };
      }
    }
  }

  // 2. Guest: read the existing cart_sid, or mint + persist a fresh one.
  const signedCartSid = jar.get(CART_SID_COOKIE)?.value;
  let cartSessionId = signedCartSid ? unsign(signedCartSid) : null;
  if (!cartSessionId) {
    cartSessionId = mintGuestSessionId();
    jar.set(CART_SID_COOKIE, sign(cartSessionId), {
      httpOnly: true,
      secure: env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      domain: env.COOKIE_DOMAIN,
      maxAge: 60 * 60 * 24 * 30,
    });
  }

  return { csrfToken: mintCsrfToken(cartSessionId), authenticated: false };
}
