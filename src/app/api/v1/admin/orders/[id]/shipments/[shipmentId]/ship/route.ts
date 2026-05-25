/**
 * POST /api/v1/admin/orders/[id]/shipments/[shipmentId]/ship
 *
 * Body (optional): { trackingNumber?, carrier? }
 *
 * Flips the fulfillment (and its paired shipment, 1:1 in this stream) to
 * 'shipped'. Records tracking info if supplied. Emits `order.shipped` via
 * the outbox. Does NOT transition the order's status — that hop happens
 * only when ALL items are fulfilled (during `createFulfillment`) or when
 * every fulfillment is delivered (during `markDelivered`).
 *
 * URL semantics: `shipmentId` here refers to the fulfillment id — Stream B
 * pairs one shipment per fulfillment by construction. A future plan that
 * decouples shipments from fulfillments will introduce a separate
 * `/fulfillments/[id]/ship` route.
 */

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { markShipped } from '@/modules/orders/fulfillment';
import { problem } from '@/lib/errors';
import { withIdempotency } from '@/lib/idempotency';
import { mapOrderError, readJsonBody, runAdminPipeline } from '../../../../_lib';

const bodySchema = z
  .object({
    trackingNumber: z.string().min(1).optional(),
    carrier: z.string().min(1).optional(),
  })
  .strict()
  .optional();

type RouteCtx = { params: Promise<{ id: string; shipmentId: string }> };

export async function POST(req: Request, ctx: RouteCtx): Promise<NextResponse> {
  const pipeline = await runAdminPipeline(req, {
    requireMutation: true,
    permission: 'orders:write',
  });
  if (!pipeline.ok) return pipeline.response;

  const { id, shipmentId } = await ctx.params;

  let trackingNumber: string | undefined;
  let carrier: string | undefined;
  const contentLength = req.headers.get('content-length');
  if (contentLength && contentLength !== '0') {
    const parsed = await readJsonBody(req);
    if (!parsed.ok) return parsed.response;
    const validated = bodySchema.safeParse(parsed.data);
    if (!validated.success) {
      return problem(
        422,
        'invalid-body',
        'Invalid ship body',
        validated.error.issues.map(i => ({
          path: i.path.map(p => String(p)),
          message: i.message,
        })),
      );
    }
    trackingNumber = validated.data?.trackingNumber;
    carrier = validated.data?.carrier;
  }

  try {
    const result = await withIdempotency(
      `admin:orders:ship:${pipeline.storeId}:${id}:${shipmentId}`,
      pipeline.idempotencyKey!,
      async () =>
        markShipped(pipeline.storeId, shipmentId, {
          ...(trackingNumber !== undefined ? { trackingNumber } : {}),
          ...(carrier !== undefined ? { carrier } : {}),
          actor: { actorType: 'admin', actorId: pipeline.session.userId },
        }),
    );
    return NextResponse.json({ data: result });
  } catch (err) {
    return mapOrderError(err);
  }
}
