/**
 * Storefront cart: read.
 *
 * GET /api/v1/cart/:id
 *
 * Loads the cart + items via the cart module and re-prices through the
 * canonical pricing engine. Used by the storefront mini-cart, the cart page,
 * and the checkout review screen — all three call the same endpoint so totals
 * never diverge.
 *
 * Ownership check:
 *   - Logged-in (userSession present): cart.customerId MUST equal userSession.userId.
 *   - Guest:                            cart.sessionId  MUST equal ctx.sessionId.
 *
 * A mismatch returns 404 (not 403) so we don't leak the existence of carts
 * that belong to other browsers. The cookie is rolled on every successful read.
 */

import { NextResponse } from 'next/server';
import { getCart } from '@/modules/cart/cart';
import { priceCart } from '@/modules/cart/pricing';
import { problem } from '@/lib/errors';
import {
  attachCartSidCookie,
  cartIsOwnedBy,
  mapCartError,
  resolveStorefrontContext,
} from '../_lib';

type Params = { id: string };

export async function GET(
  req: Request,
  ctx: { params: Promise<Params> },
): Promise<NextResponse> {
  const resolved = await resolveStorefrontContext(req);
  if (!resolved.ok) return resolved.response;
  const { ctx: sctx } = resolved;

  const { id } = await ctx.params;
  if (!id) {
    return problem(400, 'invalid-path', 'cart id is required', [
      { path: ['id'], message: 'required' },
    ]);
  }

  try {
    const cart = await getCart(sctx.storeId, id);
    if (!cart) {
      return problem(404, 'cart-not-found', `Cart not found: ${id}`, []);
    }

    if (!cartIsOwnedBy(cart, sctx)) {
      return problem(404, 'cart-not-found', `Cart not found: ${id}`, []);
    }

    const totals = await priceCart(sctx.storeId, id);
    return attachCartSidCookie(NextResponse.json({ data: { cart, totals } }), sctx);
  } catch (err) {
    return mapCartError(err);
  }
}
