/**
 * Storefront cart items: add.
 *
 * POST /api/v1/cart/:id/items
 * Body: `{ variantId: string (uuid), qty: number (>=1) }`
 *
 * Ownership is verified against the resolved storefront context — a guest
 * cannot mutate a customer's cart, and vice versa. On conflict (same variant
 * already in cart), the cart module's `addItem` sums qtys per the upsert in
 * SP-4 §Task 12. Re-priced totals are returned so the client can render the
 * updated mini-cart without a follow-up GET.
 *
 * Gates: Idempotency-Key + CSRF (against ctx.sessionId).
 */

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { addItem, getCart } from '@/modules/cart/cart';
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

const bodySchema = z
  .object({
    variantId: z.string().uuid(),
    qty: z.number().int().positive(),
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
    // Ownership check first — load via getCart() (re-uses the cart module's
    // tenant scope) and short-circuit before withIdempotency caches a failure.
    const existing = await getCart(sctx.storeId, id);
    if (!existing || !cartIsOwnedBy(existing, sctx)) {
      return problem(404, 'cart-not-found', `Cart not found: ${id}`, []);
    }

    const payload = await withIdempotency(
      `storefront:cart:add-item:${sctx.storeId}:${id}`,
      gate.idempotencyKey,
      async () => {
        const cart = await addItem(sctx.storeId, id, {
          variantId: body.variantId,
          qty: body.qty,
        });
        const totals = await priceCart(sctx.storeId, id);
        return { cart, totals };
      },
    );

    return attachCartSidCookie(NextResponse.json({ data: payload }), sctx);
  } catch (err) {
    return mapCartError(err);
  }
}
