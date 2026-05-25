/**
 * Storefront order detail.
 *
 * GET /api/v1/orders/:number
 *
 * Two authorisation modes:
 *   - Logged-in (sid cookie present): the order's `customerId` MUST match
 *     `userSession.userId`. Email query is ignored.
 *   - Guest:  caller MUST supply `?email=...` matching `orders.email` exactly
 *     (case-insensitive). This is the "order tracking by email" flow for
 *     guest checkouts.
 *
 * Mismatch returns 404 (not 403) so we never reveal whether an order number
 * exists for someone else's account.
 *
 * Response shape: `{ data: { order, items } }` where `order` is the order row
 * without `items` and `items` is the flat list of order_items.
 */

import { NextResponse } from 'next/server';
import { getOrderByNumber } from '@/modules/checkout/orders';
import { problem } from '@/lib/errors';
import { resolveStorefrontContext } from '../../cart/_lib';

type Params = { number: string };

export async function GET(
  req: Request,
  ctx: { params: Promise<Params> },
): Promise<NextResponse> {
  const resolved = await resolveStorefrontContext(req);
  if (!resolved.ok) return resolved.response;
  const { ctx: sctx } = resolved;

  const { number } = await ctx.params;
  if (!number) {
    return problem(400, 'invalid-path', 'order number is required', [
      { path: ['number'], message: 'required' },
    ]);
  }

  const url = new URL(req.url);
  const emailParam = url.searchParams.get('email')?.trim().toLowerCase() ?? null;

  const order = await getOrderByNumber(sctx.storeId, number);
  if (!order) {
    return problem(404, 'order-not-found', `Order not found: ${number}`, []);
  }

  if (sctx.userSession) {
    // Logged-in: must own the order.
    if (order.customerId !== sctx.userSession.userId) {
      return problem(404, 'order-not-found', `Order not found: ${number}`, []);
    }
  } else {
    // Guest: must match email.
    if (!emailParam) {
      return problem(
        400,
        'email-required',
        'Email query parameter required for guest order lookup',
        [{ path: ['email'], message: 'required' }],
      );
    }
    if (order.email.trim().toLowerCase() !== emailParam) {
      return problem(404, 'order-not-found', `Order not found: ${number}`, []);
    }
  }

  // Split items off the row to match the documented response shape.
  const { items, ...orderRow } = order;
  return NextResponse.json({ data: { order: orderRow, items } });
}
