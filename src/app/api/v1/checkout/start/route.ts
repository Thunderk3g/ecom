/**
 * Storefront checkout: start.
 *
 * POST /api/v1/checkout/start
 * Body: `{ cartId: string (uuid), provider: 'razorpay' | 'stripe' }`
 *
 * Ownership: the cart must belong to the current storefront caller. We load
 * the cart via `getCart` and verify with `cartIsOwnedBy` before invoking
 * `startCheckout` — this prevents a logged-in customer from kicking off a
 * checkout against another browser's guest cart.
 *
 * The module's `startCheckout`:
 *   1. Validates cart shape (EmptyCartError / MissingShippingAddressError).
 *   2. Re-prices (server-authoritative totals).
 *   3. Returns the existing 'attached' intent if amount matches (idempotent
 *      against double-click).
 *   4. Reserves inventory at the default location.
 *   5. Mints the provider intent.
 *   6. Persists `payment_intents` row.
 *
 * Gates: Idempotency-Key + CSRF.
 *
 * Response: `{ data: { intentId, providerRef, clientSecret?, totals } }`.
 */

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { startCheckout } from '@/modules/checkout/checkout';
import { getCart } from '@/modules/cart/cart';
import { withIdempotency } from '@/lib/idempotency';
import { withRateLimit } from '@/lib/rate-limit';
import { problem } from '@/lib/errors';
import {
  attachCartSidCookie,
  cartIsOwnedBy,
  readJsonBody,
  requireMutationGate,
  resolveStorefrontContext,
} from '../../cart/_lib';
import { mapCheckoutError } from '../_lib';

const bodySchema = z
  .object({
    cartId: z.string().uuid(),
    provider: z.enum(['razorpay', 'stripe']),
  })
  .strict();

export async function POST(req: Request): Promise<NextResponse> {
  // Per-IP rate limit: 20/min. Checkout starts are expensive (price + reserve
  // + mint provider intent) so we cap them tighter than cart mutations.
  const limited = await withRateLimit(req, { limit: 20, windowSeconds: 60 });
  if (limited) return limited;

  const resolved = await resolveStorefrontContext(req);
  if (!resolved.ok) return resolved.response;
  const { ctx: sctx } = resolved;

  const gate = requireMutationGate(req, sctx);
  if (!gate.ok) return gate.response;

  const parsedBody = await readJsonBody(req);
  if (!parsedBody.ok) return parsedBody.response;
  const validated = bodySchema.safeParse(parsedBody.data);
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
  const body = validated.data;

  try {
    // Ownership check (404 — don't leak the cart's existence to other browsers).
    const cart = await getCart(sctx.storeId, body.cartId);
    if (!cart || !cartIsOwnedBy(cart, sctx)) {
      return problem(404, 'cart-not-found', `Cart not found: ${body.cartId}`, []);
    }

    const payload = await withIdempotency(
      `storefront:checkout:start:${sctx.storeId}:${body.cartId}`,
      gate.idempotencyKey,
      async () =>
        startCheckout(sctx.storeId, {
          cartId: body.cartId,
          provider: body.provider,
        }),
    );

    return attachCartSidCookie(NextResponse.json({ data: payload }), sctx);
  } catch (err) {
    return mapCheckoutError(err);
  }
}
