/**
 * Storefront cart items: update + remove.
 *
 * PATCH  /api/v1/cart/:id/items/:lineId   — body: { qty: number }; qty <= 0
 *                                            falls through to removeItem inside
 *                                            the cart module.
 * DELETE /api/v1/cart/:id/items/:lineId   — no body.
 *
 * Both verify ownership against the storefront context (404 on mismatch) and
 * are gated by Idempotency-Key + CSRF. Re-priced totals come back with the
 * updated cart so the client can refresh without an extra round-trip.
 */

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getCart, removeItem, updateItem } from '@/modules/cart/cart';
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
} from '../../../_lib';

const patchBodySchema = z
  .object({
    qty: z.number().int(),
  })
  .strict();

type Params = { id: string; lineId: string };

async function ensureOwnedCart(
  storeId: string,
  id: string,
  ctx: Parameters<typeof cartIsOwnedBy>[1],
): Promise<NextResponse | null> {
  const existing = await getCart(storeId, id);
  if (!existing || !cartIsOwnedBy(existing, ctx)) {
    return problem(404, 'cart-not-found', `Cart not found: ${id}`, []);
  }
  return null;
}

export async function PATCH(
  req: Request,
  ctx: { params: Promise<Params> },
): Promise<NextResponse> {
  const resolved = await resolveStorefrontContext(req);
  if (!resolved.ok) return resolved.response;
  const { ctx: sctx } = resolved;

  const gate = requireMutationGate(req, sctx);
  if (!gate.ok) return gate.response;

  const { id, lineId } = await ctx.params;
  if (!id || !lineId) {
    return problem(400, 'invalid-path', 'cart id and line id are required', [
      { path: ['id'], message: 'required' },
    ]);
  }

  const parsedBody = await readJsonBody(req);
  if (!parsedBody.ok) return parsedBody.response;
  const validated = patchBodySchema.safeParse(parsedBody.data);
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
    const ownership = await ensureOwnedCart(sctx.storeId, id, sctx);
    if (ownership) return ownership;

    const payload = await withIdempotency(
      `storefront:cart:patch-item:${sctx.storeId}:${id}:${lineId}`,
      gate.idempotencyKey,
      async () => {
        const cart = await updateItem(sctx.storeId, id, lineId, {
          qty: validated.data.qty,
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

export async function DELETE(
  req: Request,
  ctx: { params: Promise<Params> },
): Promise<NextResponse> {
  const resolved = await resolveStorefrontContext(req);
  if (!resolved.ok) return resolved.response;
  const { ctx: sctx } = resolved;

  const gate = requireMutationGate(req, sctx);
  if (!gate.ok) return gate.response;

  const { id, lineId } = await ctx.params;
  if (!id || !lineId) {
    return problem(400, 'invalid-path', 'cart id and line id are required', [
      { path: ['id'], message: 'required' },
    ]);
  }

  try {
    const ownership = await ensureOwnedCart(sctx.storeId, id, sctx);
    if (ownership) return ownership;

    const payload = await withIdempotency(
      `storefront:cart:delete-item:${sctx.storeId}:${id}:${lineId}`,
      gate.idempotencyKey,
      async () => {
        const cart = await removeItem(sctx.storeId, id, lineId);
        const totals = await priceCart(sctx.storeId, id);
        return { cart, totals };
      },
    );

    return attachCartSidCookie(NextResponse.json({ data: payload }), sctx);
  } catch (err) {
    return mapCartError(err);
  }
}
