/**
 * POST /api/v1/admin/orders/[id]/shipments/[shipmentId]/deliver
 *
 * Flips a shipped fulfillment (+ its paired shipment) to 'delivered'. When
 * every fulfillment on the order is delivered, transitions the order to
 * 'completed' and emits `order.completed`. Always emits `order.delivered`.
 *
 * URL semantics: see `./ship/route.ts` — `shipmentId` is the fulfillment id
 * in this stream's 1:1 design.
 */

import { NextResponse } from 'next/server';
import { markDelivered } from '@/modules/orders/fulfillment';
import { withIdempotency } from '@/lib/idempotency';
import { mapOrderError, runAdminPipeline } from '../../../../_lib';

type RouteCtx = { params: Promise<{ id: string; shipmentId: string }> };

export async function POST(req: Request, ctx: RouteCtx): Promise<NextResponse> {
  const pipeline = await runAdminPipeline(req, {
    requireMutation: true,
    permission: 'orders:write',
  });
  if (!pipeline.ok) return pipeline.response;

  const { id, shipmentId } = await ctx.params;

  try {
    const result = await withIdempotency(
      `admin:orders:deliver:${pipeline.storeId}:${id}:${shipmentId}`,
      pipeline.idempotencyKey!,
      async () =>
        markDelivered(pipeline.storeId, shipmentId, {
          actorType: 'admin',
          actorId: pipeline.session.userId,
        }),
    );
    return NextResponse.json({ data: result });
  } catch (err) {
    return mapOrderError(err);
  }
}
