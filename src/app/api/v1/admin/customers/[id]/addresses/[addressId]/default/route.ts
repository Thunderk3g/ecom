/**
 * POST /api/v1/admin/customers/[id]/addresses/[addressId]/default
 *
 * Body: { slot: 'billing' | 'shipping' }
 *
 * Promotes `addressId` to the default for the given semantic slot for the
 * referenced customer. Unsets any prior default whose type covers the slot.
 * 404 maps to either CustomerNotFoundError or AddressNotFoundError (the
 * module also reuses AddressNotFoundError for type-incompatibility — see
 * `setDefaultAddress` docs).
 */

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { setDefaultAddress } from '@/modules/customers/addresses';
import { problem } from '@/lib/errors';
import { withIdempotency } from '@/lib/idempotency';
import { mapCustomerError, readJsonBody, runAdminPipeline } from '../../../../_lib';

const bodySchema = z
  .object({
    slot: z.enum(['billing', 'shipping']),
  })
  .strict();

type RouteCtx = { params: Promise<{ id: string; addressId: string }> };

export async function POST(req: Request, ctx: RouteCtx): Promise<NextResponse> {
  const pipeline = await runAdminPipeline(req, {
    requireMutation: true,
    permission: 'customers:write',
  });
  if (!pipeline.ok) return pipeline.response;

  const { id, addressId } = await ctx.params;
  const parsed = await readJsonBody(req);
  if (!parsed.ok) return parsed.response;
  const validated = bodySchema.safeParse(parsed.data);
  if (!validated.success) {
    return problem(
      422,
      'invalid-body',
      'Invalid set-default body',
      validated.error.issues.map(i => ({
        path: i.path.map(p => String(p)),
        message: i.message,
      })),
    );
  }

  try {
    const updated = await withIdempotency(
      `admin:customers:addresses:default:${pipeline.storeId}:${id}:${addressId}:${validated.data.slot}`,
      pipeline.idempotencyKey!,
      async () => setDefaultAddress(pipeline.storeId, id, addressId, validated.data.slot),
    );
    return NextResponse.json({ data: updated });
  } catch (err) {
    return mapCustomerError(err);
  }
}
