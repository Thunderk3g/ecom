/**
 * Storefront cart addresses: set shipping + billing.
 *
 * PATCH /api/v1/cart/:id/addresses
 * Body: `{ shippingAddress?: Address; billingAddress?: Address }`
 *
 * Either field is optional; only the provided fields are written. The Address
 * shape is `{ name, line1, line2?, city, region, postal, country, phone? }` per
 * `src/db/schema/carts.ts`. Setting a shipping address is a prerequisite for
 * `/checkout/start` — the storefront typically calls this just before kicking
 * off checkout.
 *
 * Gates: Idempotency-Key + CSRF. Ownership via storefront context (404 on
 * mismatch).
 */

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getCart, setAddresses } from '@/modules/cart/cart';
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

const addressSchema = z
  .object({
    name: z.string().min(1),
    line1: z.string().min(1),
    line2: z.string().optional(),
    city: z.string().min(1),
    region: z.string().min(1),
    postal: z.string().min(1),
    country: z.string().min(2),
    phone: z.string().optional(),
  })
  .strict();

const bodySchema = z
  .object({
    shippingAddress: addressSchema.optional(),
    billingAddress: addressSchema.optional(),
  })
  .strict()
  .refine(
    v => v.shippingAddress !== undefined || v.billingAddress !== undefined,
    {
      message: 'At least one of shippingAddress or billingAddress is required',
      path: ['shippingAddress'],
    },
  );

type Params = { id: string };

export async function PATCH(
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
    const existing = await getCart(sctx.storeId, id);
    if (!existing || !cartIsOwnedBy(existing, sctx)) {
      return problem(404, 'cart-not-found', `Cart not found: ${id}`, []);
    }

    const payload = await withIdempotency(
      `storefront:cart:addresses:${sctx.storeId}:${id}`,
      gate.idempotencyKey,
      async () => {
        const cart = await setAddresses(sctx.storeId, id, {
          ...(body.shippingAddress !== undefined
            ? { shippingAddress: body.shippingAddress }
            : {}),
          ...(body.billingAddress !== undefined
            ? { billingAddress: body.billingAddress }
            : {}),
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
