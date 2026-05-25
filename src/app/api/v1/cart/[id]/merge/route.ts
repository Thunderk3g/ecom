/**
 * Storefront cart merge-on-login.
 *
 * POST /api/v1/cart/:id/merge   (no body)
 *
 * Requires an authenticated user session (`sid` cookie). The path's `:id` is
 * the guest cart the caller wishes to fold into their customer cart — we
 * verify it belongs to the current `cart_sid` so a logged-in user can't
 * vacuum another browser's guest cart by guessing ids.
 *
 * Calls `mergeOnLogin(storeId, sessionId, customerId)`:
 *   - Finds the guest cart by (storeId, cart_sid, customerId IS NULL).
 *   - Finds or creates the customer's cart by (storeId, customerId).
 *   - Sums item qtys; inherits coupon/addresses only when absent on the
 *     customer cart.
 *   - Deletes the guest cart (items cascade).
 *
 * Gates: Idempotency-Key + CSRF (against the user session id).
 *
 * Response: `{ data: { cart, totals } }` for the resulting customer cart.
 */

import { NextResponse } from 'next/server';
import { unsign } from '@/lib/cookies';
import { getCart, mergeOnLogin } from '@/modules/cart/cart';
import { priceCart } from '@/modules/cart/pricing';
import { withIdempotency } from '@/lib/idempotency';
import { problem } from '@/lib/errors';
import {
  CART_SID_COOKIE,
  attachCartSidCookie,
  mapCartError,
  requireMutationGate,
  resolveStorefrontContext,
} from '../../_lib';

type Params = { id: string };

function readCookie(req: Request, name: string): string | undefined {
  const header = req.headers.get('cookie');
  if (!header) return undefined;
  for (const piece of header.split(';')) {
    const eq = piece.indexOf('=');
    if (eq < 0) continue;
    const k = piece.slice(0, eq).trim();
    if (k === name) return decodeURIComponent(piece.slice(eq + 1).trim());
  }
  return undefined;
}

export async function POST(
  req: Request,
  ctx: { params: Promise<Params> },
): Promise<NextResponse> {
  const resolved = await resolveStorefrontContext(req);
  if (!resolved.ok) return resolved.response;
  const { ctx: sctx } = resolved;

  // Merge requires the user to be logged in — there's nothing to merge into otherwise.
  if (!sctx.userSession) {
    return problem(401, 'unauthenticated', 'Authentication required to merge cart', []);
  }

  const gate = requireMutationGate(req, sctx);
  if (!gate.ok) return gate.response;

  const { id } = await ctx.params;
  if (!id) {
    return problem(400, 'invalid-path', 'cart id is required', [
      { path: ['id'], message: 'required' },
    ]);
  }

  // The guest cart we are folding in must belong to this browser's cart_sid.
  // (resolveStorefrontContext picks `sessionId = userSession.id` when logged
  // in, so cart_sid must be read separately here.)
  const signedCartSid = readCookie(req, CART_SID_COOKIE);
  const guestSessionId = signedCartSid ? unsign(signedCartSid) : null;
  if (!guestSessionId) {
    return problem(
      400,
      'missing-cart-cookie',
      'No guest cart_sid cookie present to merge from',
      [{ path: ['cookie', CART_SID_COOKIE], message: 'required' }],
    );
  }

  try {
    // Verify the target cart is the guest cart for this cart_sid.
    const guestCart = await getCart(sctx.storeId, id);
    if (
      !guestCart ||
      guestCart.customerId !== null ||
      guestCart.sessionId !== guestSessionId
    ) {
      return problem(404, 'cart-not-found', `Cart not found: ${id}`, []);
    }

    const payload = await withIdempotency(
      `storefront:cart:merge:${sctx.storeId}:${sctx.userSession.userId}`,
      gate.idempotencyKey,
      async () => {
        const merged = await mergeOnLogin(
          sctx.storeId,
          guestSessionId,
          sctx.userSession!.userId,
        );
        const withItems = await getCart(sctx.storeId, merged.id);
        const totals = await priceCart(sctx.storeId, merged.id);
        return { cart: withItems ?? merged, totals };
      },
    );

    return attachCartSidCookie(NextResponse.json({ data: payload }), sctx);
  } catch (err) {
    return mapCartError(err);
  }
}
