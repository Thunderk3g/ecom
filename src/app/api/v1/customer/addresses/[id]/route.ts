/**
 * Storefront single-address operations.
 *
 *   PATCH  /api/v1/customer/addresses/:id   — update fields (type, name, ...).
 *   DELETE /api/v1/customer/addresses/:id   — remove the address.
 *
 * Both verify the address exists AND belongs to the authenticated customer.
 * Cross-customer access renders 404 (not 403) to prevent enumeration.
 *
 * Gates: CSRF + Idempotency-Key. The default flag is NOT settable here — use
 * the `[id]/default` sub-route which has slot-aware semantics.
 */

import { NextResponse } from 'next/server';
import { z } from 'zod';
import {
  deleteAddress,
  getAddress,
  updateAddress,
} from '@/modules/customers/addresses';
import { withIdempotency } from '@/lib/idempotency';
import { problem } from '@/lib/errors';
import {
  mapCustomerError,
  readJsonBody,
  requireMutationGate,
  resolveTenantAndCustomerSession,
} from '../../_lib';

type Params = { id: string };

const addressTypeSchema = z.enum(['billing', 'shipping', 'both']);

const patchBodySchema = z
  .object({
    type: addressTypeSchema.optional(),
    name: z.string().min(1).optional(),
    line1: z.string().min(1).optional(),
    line2: z.string().nullable().optional(),
    city: z.string().min(1).optional(),
    region: z.string().min(1).optional(),
    postal: z.string().min(1).optional(),
    country: z.string().min(2).optional(),
    phone: z.string().nullable().optional(),
  })
  .strict()
  .refine(v => Object.keys(v).length > 0, {
    message: 'At least one field is required',
    path: [],
  });

export async function PATCH(
  req: Request,
  routeCtx: { params: Promise<Params> },
): Promise<NextResponse> {
  const resolved = await resolveTenantAndCustomerSession(req);
  if (!resolved.ok) return resolved.response;
  const { ctx } = resolved;

  const gate = requireMutationGate(req, ctx);
  if (!gate.ok) return gate.response;

  const { id } = await routeCtx.params;
  if (!id) {
    return problem(400, 'invalid-path', 'address id is required', [
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
  const body = validated.data;

  try {
    // Ownership check before mutate — render 404 (not 403) on mismatch so we
    // don't leak the existence of foreign addresses.
    const existing = await getAddress(ctx.storeId, id);
    if (existing.customerId !== ctx.customer.id) {
      return problem(404, 'address-not-found', `Address not found: ${id}`, []);
    }

    const address = await withIdempotency(
      `storefront:customer:addresses:update:${ctx.storeId}:${id}`,
      gate.idempotencyKey,
      async () =>
        updateAddress(ctx.storeId, id, {
          ...(body.type !== undefined ? { type: body.type } : {}),
          ...(body.name !== undefined ? { name: body.name } : {}),
          ...(body.line1 !== undefined ? { line1: body.line1 } : {}),
          ...(body.line2 !== undefined ? { line2: body.line2 } : {}),
          ...(body.city !== undefined ? { city: body.city } : {}),
          ...(body.region !== undefined ? { region: body.region } : {}),
          ...(body.postal !== undefined ? { postal: body.postal } : {}),
          ...(body.country !== undefined ? { country: body.country } : {}),
          ...(body.phone !== undefined ? { phone: body.phone } : {}),
        }),
    );
    return NextResponse.json({ data: address });
  } catch (err) {
    return mapCustomerError(err);
  }
}

export async function DELETE(
  req: Request,
  routeCtx: { params: Promise<Params> },
): Promise<NextResponse> {
  const resolved = await resolveTenantAndCustomerSession(req);
  if (!resolved.ok) return resolved.response;
  const { ctx } = resolved;

  const gate = requireMutationGate(req, ctx);
  if (!gate.ok) return gate.response;

  const { id } = await routeCtx.params;
  if (!id) {
    return problem(400, 'invalid-path', 'address id is required', [
      { path: ['id'], message: 'required' },
    ]);
  }

  try {
    const existing = await getAddress(ctx.storeId, id);
    if (existing.customerId !== ctx.customer.id) {
      return problem(404, 'address-not-found', `Address not found: ${id}`, []);
    }

    await withIdempotency(
      `storefront:customer:addresses:delete:${ctx.storeId}:${id}`,
      gate.idempotencyKey,
      async () => {
        await deleteAddress(ctx.storeId, id);
        return { deleted: true };
      },
    );
    return new NextResponse(null, { status: 204 });
  } catch (err) {
    return mapCustomerError(err);
  }
}
