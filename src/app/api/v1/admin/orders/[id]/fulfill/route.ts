/**
 * POST /api/v1/admin/orders/[id]/fulfill
 *
 * Body: { items: [{ orderItemId, qty }], trackingNumber?, carrier? }
 *
 * Creates a fulfillment (+ paired shipment) against the order. Recomputes
 * `orders.fulfillment_status` and, when the order is fully fulfilled,
 * transitions it to 'fulfilled' (emits `order.fulfilled` via the outbox).
 */

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createFulfillment } from '@/modules/orders/fulfillment';
import { problem } from '@/lib/errors';
import { withIdempotency } from '@/lib/idempotency';
import { mapOrderError, readJsonBody, runAdminPipeline } from '../../_lib';

const bodySchema = z
  .object({
    items: z
      .array(
        z
          .object({
            orderItemId: z.string().uuid(),
            qty: z.number().int().positive(),
          })
          .strict(),
      )
      .min(1),
    trackingNumber: z.string().min(1).optional(),
    carrier: z.string().min(1).optional(),
  })
  .strict();

type RouteCtx = { params: Promise<{ id: string }> };

export async function POST(req: Request, ctx: RouteCtx): Promise<NextResponse> {
  const pipeline = await runAdminPipeline(req, {
    requireMutation: true,
    permission: 'orders:write',
  });
  if (!pipeline.ok) return pipeline.response;

  const { id } = await ctx.params;

  const parsed = await readJsonBody(req);
  if (!parsed.ok) return parsed.response;
  const validated = bodySchema.safeParse(parsed.data);
  if (!validated.success) {
    return problem(
      422,
      'invalid-body',
      'Invalid fulfill body',
      validated.error.issues.map(i => ({
        path: i.path.map(p => String(p)),
        message: i.message,
      })),
    );
  }

  try {
    const result = await withIdempotency(
      `admin:orders:fulfill:${pipeline.storeId}:${id}`,
      pipeline.idempotencyKey!,
      async () =>
        createFulfillment(pipeline.storeId, {
          orderId: id,
          items: validated.data.items,
          ...(validated.data.trackingNumber !== undefined
            ? { trackingNumber: validated.data.trackingNumber }
            : {}),
          ...(validated.data.carrier !== undefined ? { carrier: validated.data.carrier } : {}),
          actor: { actorType: 'admin', actorId: pipeline.session.userId },
        }),
    );
    return NextResponse.json({ data: result }, { status: 201 });
  } catch (err) {
    return mapOrderError(err);
  }
}
