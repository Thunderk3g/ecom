/**
 * POST /api/v1/admin/inventory/purchase-orders/[id]/receive
 *
 * Receives items against a PO. Body shape:
 *   { items: [{ variantId, qty, locationId }], createdBy? }
 *
 * `receivePurchaseOrder()` appends inbound movements, increments
 * `qty_received`, and flips status to 'partial' or 'received' atomically.
 * Over-receive (qty > outstanding) surfaces as 422 via OverReceiveError.
 *
 * `createdBy` defaults to the session user; an admin may also pass it in the
 * body (e.g. when receiving on behalf of a warehouse user).
 */

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { receivePurchaseOrder } from '@/modules/inventory/purchase-orders';
import { problem } from '@/lib/errors';
import { withIdempotency } from '@/lib/idempotency';
import { mapInventoryError, readJsonBody, runAdminPipeline } from '../../../_lib';

const receiveBody = z.object({
  items: z
    .array(
      z.object({
        variantId: z.string().uuid(),
        qty: z.number().int().positive(),
        locationId: z.string().uuid(),
      }),
    )
    .min(1),
  createdBy: z.string().uuid().optional(),
});

type RouteCtx = { params: Promise<{ id: string }> };

export async function POST(req: Request, ctx: RouteCtx): Promise<NextResponse> {
  const pipeline = await runAdminPipeline(req, {
    requireMutation: true,
    permission: 'inventory:write',
  });
  if (!pipeline.ok) return pipeline.response;

  const { id: poId } = await ctx.params;
  const parsed = await readJsonBody(req);
  if (!parsed.ok) return parsed.response;
  const validated = receiveBody.safeParse(parsed.data);
  if (!validated.success) {
    return problem(
      422,
      'invalid-body',
      'Invalid receive body',
      validated.error.issues.map(i => ({ path: i.path.map(p => String(p)), message: i.message })),
    );
  }

  try {
    const result = await withIdempotency(
      `admin:inventory:purchase-orders:receive:${pipeline.storeId}:${poId}`,
      pipeline.idempotencyKey!,
      async () =>
        receivePurchaseOrder(pipeline.storeId, {
          poId,
          items: validated.data.items.map(it => ({
            variantId: it.variantId,
            qty: it.qty,
            locationId: it.locationId,
          })),
          createdBy: validated.data.createdBy ?? pipeline.session.userId,
        }),
    );
    return NextResponse.json({ data: result });
  } catch (err) {
    return mapInventoryError(err);
  }
}
