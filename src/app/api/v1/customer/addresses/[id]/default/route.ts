/**
 * Storefront: promote an address to the customer's default for a given slot.
 *
 * POST /api/v1/customer/addresses/:id/default
 * Body: `{ slot: 'billing' | 'shipping' }`
 *
 * The module's `setDefaultAddress` atomically un-flags any prior default for
 * the same semantic slot (including `'both'`-typed rows that overlap) and
 * flips the target row. The target's `type` must be compatible with the slot
 * (e.g. you cannot promote a billing-only row into the shipping slot); the
 * module enforces this and renders 404 on mismatch.
 *
 * Gates: CSRF + Idempotency-Key. Ownership of the address is verified before
 * delegating so cross-customer ids return 404, not 403.
 */

import { NextResponse } from 'next/server';
import { z } from 'zod';
import {
  getAddress,
  setDefaultAddress,
} from '@/modules/customers/addresses';
import { withIdempotency } from '@/lib/idempotency';
import { problem } from '@/lib/errors';
import {
  mapCustomerError,
  readJsonBody,
  requireMutationGate,
  resolveTenantAndCustomerSession,
} from '../../../_lib';

type Params = { id: string };

const bodySchema = z
  .object({
    slot: z.enum(['billing', 'shipping']),
  })
  .strict();

export async function POST(
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
    const existing = await getAddress(ctx.storeId, id);
    if (existing.customerId !== ctx.customer.id) {
      return problem(404, 'address-not-found', `Address not found: ${id}`, []);
    }

    const address = await withIdempotency(
      `storefront:customer:addresses:default:${ctx.storeId}:${id}:${body.slot}`,
      gate.idempotencyKey,
      async () =>
        setDefaultAddress(ctx.storeId, ctx.customer.id, id, body.slot),
    );
    return NextResponse.json({ data: address });
  } catch (err) {
    return mapCustomerError(err);
  }
}
