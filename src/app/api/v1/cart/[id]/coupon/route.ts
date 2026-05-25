/**
 * Storefront cart coupon: apply + remove.
 *
 * POST   /api/v1/cart/:id/coupon  — body: { code: string }. Calls
 *                                   `applyCoupon` which validates the code
 *                                   (throws InvalidCouponError / CouponExpiredError /
 *                                   CouponUsageExhaustedError before writing).
 * DELETE /api/v1/cart/:id/coupon  — clears `carts.couponCode` to null.
 *
 * Both gates: Idempotency-Key + CSRF. Ownership check against the storefront
 * context returns 404 on mismatch (we never leak that another browser's cart
 * exists).
 */

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { applyCoupon, getCart, removeCoupon } from '@/modules/cart/cart';
import { priceCart } from '@/modules/cart/pricing';
import { withIdempotency } from '@/lib/idempotency';
import { problem } from '@/lib/errors';
import {
  attachCartSidCookie,
  cartIsOwnedBy,
  mapCartError,
  readJsonBody,
  requireMutationGate,
  resolveStorefrontContext,
} from '../../_lib';

const applyBodySchema = z
  .object({
    code: z.string().min(1).max(64),
  })
  .strict();

type Params = { id: string };

export async function POST(
  req: Request,
  ctx: { params: Promise<Params> },
): Promise<NextResponse> {
  const resolved = await resolveStorefrontContext(req);
  if (!resolved.ok) return resolved.response;
  const { ctx: sctx } = resolved;

  const gate = requireMutationGate(req, sctx);
  if (!gate.ok) return gate.response;

  const { id } = await ctx.params;
  if (!id) {
    return problem(400, 'invalid-path', 'cart id is required', [
      { path: ['id'], message: 'required' },
    ]);
  }

  const parsedBody = await readJsonBody(req);
  if (!parsedBody.ok) return parsedBody.response;
  const validated = applyBodySchema.safeParse(parsedBody.data);
  if (!validated.success) {
    return problem(
      400,
      'invalid-body',
      'Invalid request body',
      validated.error.issues.map(i => ({
        path: i.path.map(p => String(p)),
        message: i.message,
      })),
    );
  }

  try {
    const existing = await getCart(sctx.storeId, id);
    if (!existing || !cartIsOwnedBy(existing, sctx)) {
      return problem(404, 'cart-not-found', `Cart not found: ${id}`, []);
    }

    const payload = await withIdempotency(
      `storefront:cart:apply-coupon:${sctx.storeId}:${id}`,
      gate.idempotencyKey,
      async () => {
        const cart = await applyCoupon(sctx.storeId, id, validated.data.code);
        const totals = await priceCart(sctx.storeId, id);
        return { cart, totals };
      },
    );

    return attachCartSidCookie(NextResponse.json({ data: payload }), sctx);
  } catch (err) {
    return mapCartError(err);
  }
}

export async function DELETE(
  req: Request,
  ctx: { params: Promise<Params> },
): Promise<NextResponse> {
  const resolved = await resolveStorefrontContext(req);
  if (!resolved.ok) return resolved.response;
  const { ctx: sctx } = resolved;

  const gate = requireMutationGate(req, sctx);
  if (!gate.ok) return gate.response;

  const { id } = await ctx.params;
  if (!id) {
    return problem(400, 'invalid-path', 'cart id is required', [
      { path: ['id'], message: 'required' },
    ]);
  }

  try {
    const existing = await getCart(sctx.storeId, id);
    if (!existing || !cartIsOwnedBy(existing, sctx)) {
      return problem(404, 'cart-not-found', `Cart not found: ${id}`, []);
    }

    const payload = await withIdempotency(
      `storefront:cart:remove-coupon:${sctx.storeId}:${id}`,
      gate.idempotencyKey,
      async () => {
        const cart = await removeCoupon(sctx.storeId, id);
        const totals = await priceCart(sctx.storeId, id);
        return { cart, totals };
      },
    );

    return attachCartSidCookie(NextResponse.json({ data: payload }), sctx);
  } catch (err) {
    return mapCartError(err);
  }
}
