/**
 * PATCH  /api/v1/admin/customers/[id]/addresses/[addressId] — partial update
 * DELETE /api/v1/admin/customers/[id]/addresses/[addressId] — hard delete
 *
 * `[id]` is the customer id; it is not used by the module fns (lookup is by
 * addressId scoped by RLS) but is part of the URL contract for navigability.
 */

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { deleteAddress, updateAddress } from '@/modules/customers/addresses';
import { problem } from '@/lib/errors';
import { withIdempotency } from '@/lib/idempotency';
import { mapCustomerError, readJsonBody, runAdminPipeline } from '../../../_lib';

const ADDRESS_TYPES = ['billing', 'shipping', 'both'] as const;

const patchBody = z
  .object({
    type: z.enum(ADDRESS_TYPES).optional(),
    name: z.string().min(1).optional(),
    line1: z.string().min(1).optional(),
    line2: z.string().min(1).nullable().optional(),
    city: z.string().min(1).optional(),
    region: z.string().min(1).optional(),
    postal: z.string().min(1).optional(),
    country: z.string().min(2).optional(),
    phone: z.string().min(1).nullable().optional(),
  })
  .strict();

type RouteCtx = { params: Promise<{ id: string; addressId: string }> };

export async function PATCH(req: Request, ctx: RouteCtx): Promise<NextResponse> {
  const pipeline = await runAdminPipeline(req, {
    requireMutation: true,
    permission: 'customers:write',
  });
  if (!pipeline.ok) return pipeline.response;

  const { addressId } = await ctx.params;
  const parsed = await readJsonBody(req);
  if (!parsed.ok) return parsed.response;
  const validated = patchBody.safeParse(parsed.data);
  if (!validated.success) {
    return problem(
      422,
      'invalid-body',
      'Invalid address patch',
      validated.error.issues.map(i => ({
        path: i.path.map(p => String(p)),
        message: i.message,
      })),
    );
  }

  try {
    const updated = await withIdempotency(
      `admin:customers:addresses:patch:${pipeline.storeId}:${addressId}`,
      pipeline.idempotencyKey!,
      async () =>
        updateAddress(pipeline.storeId, addressId, {
          ...(validated.data.type !== undefined ? { type: validated.data.type } : {}),
          ...(validated.data.name !== undefined ? { name: validated.data.name } : {}),
          ...(validated.data.line1 !== undefined ? { line1: validated.data.line1 } : {}),
          ...(validated.data.line2 !== undefined ? { line2: validated.data.line2 } : {}),
          ...(validated.data.city !== undefined ? { city: validated.data.city } : {}),
          ...(validated.data.region !== undefined ? { region: validated.data.region } : {}),
          ...(validated.data.postal !== undefined ? { postal: validated.data.postal } : {}),
          ...(validated.data.country !== undefined ? { country: validated.data.country } : {}),
          ...(validated.data.phone !== undefined ? { phone: validated.data.phone } : {}),
        }),
    );
    return NextResponse.json({ data: updated });
  } catch (err) {
    return mapCustomerError(err);
  }
}

export async function DELETE(req: Request, ctx: RouteCtx): Promise<NextResponse> {
  const pipeline = await runAdminPipeline(req, {
    requireMutation: true,
    permission: 'customers:write',
  });
  if (!pipeline.ok) return pipeline.response;

  const { addressId } = await ctx.params;
  try {
    await withIdempotency(
      `admin:customers:addresses:delete:${pipeline.storeId}:${addressId}`,
      pipeline.idempotencyKey!,
      async () => {
        await deleteAddress(pipeline.storeId, addressId);
        return { deleted: true } as const;
      },
    );
    return new NextResponse(null, { status: 204 });
  } catch (err) {
    return mapCustomerError(err);
  }
}
