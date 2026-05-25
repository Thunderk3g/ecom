/**
 * Storefront cart: create.
 *
 * POST /api/v1/cart
 *
 * Body: `{ customerId?: string }`. The `customerId` is optional — if the
 * caller is logged in via the storefront `sid` cookie, the server links the
 * cart to `userSession.userId` automatically. Explicit `customerId` in the
 * body is honoured for tests / SSR flows but must match the user session if
 * one is present (otherwise we ignore it to avoid letting a guest forge a
 * cart for another customer).
 *
 * Tenant: resolved from host (404 on miss).
 * Auth:   no requirement — a guest may create a cart.
 * Gates:  Idempotency-Key (header), CSRF token (against cart_sid).
 *
 * Response: 201 `{ data: { cart, totals } }`. Sets a rolling `cart_sid` cookie.
 */

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createCart } from '@/modules/cart/cart';
import { getCart } from '@/modules/cart/cart';
import { priceCart } from '@/modules/cart/pricing';
import { withIdempotency } from '@/lib/idempotency';
import { problem } from '@/lib/errors';
import {
  attachCartSidCookie,
  mapCartError,
  readJsonBody,
  requireMutationGate,
  resolveStorefrontContext,
} from './_lib';

const bodySchema = z
  .object({
    customerId: z.string().uuid().optional(),
  })
  .strict();

export async function POST(req: Request): Promise<NextResponse> {
  const resolved = await resolveStorefrontContext(req);
  if (!resolved.ok) return resolved.response;
  const { ctx } = resolved;

  const gate = requireMutationGate(req, ctx);
  if (!gate.ok) return gate.response;

  const parsedBody = await readJsonBody(req);
  if (!parsedBody.ok) return parsedBody.response;
  const validated = bodySchema.safeParse(parsedBody.data ?? {});
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

  // Logged-in carts pin to the user's id; ignore any conflicting body customerId.
  const customerId = ctx.userSession ? ctx.userSession.userId : body.customerId ?? null;

  // The cart's session id is whatever cookie identifies this storefront caller:
  // for guests that's the unsigned cart_sid value (re-derived below); for
  // authenticated callers the user-session id works equally well — both are
  // long-lived opaque strings unique per browser session.
  const sessionIdForCart = ctx.sessionId;

  try {
    const payload = await withIdempotency(
      `storefront:cart:create:${ctx.storeId}`,
      gate.idempotencyKey,
      async () => {
        const cart = await createCart(ctx.storeId, {
          sessionId: sessionIdForCart,
          customerId,
        });
        const totals = await priceCart(ctx.storeId, cart.id);
        const withItems = await getCart(ctx.storeId, cart.id);
        return { cart: withItems ?? cart, totals };
      },
    );
    return attachCartSidCookie(
      NextResponse.json({ data: payload }, { status: 201 }),
      ctx,
    );
  } catch (err) {
    return mapCartError(err);
  }
}
