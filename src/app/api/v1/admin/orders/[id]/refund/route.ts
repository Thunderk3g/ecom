/**
 * POST /api/v1/admin/orders/[id]/refund
 *
 * Body: { items: [{ orderItemId, qty, amountCents }], reason }
 *
 * Persists a `refunds` row in 'pending', calls the payment provider's
 * refundPayment OUTSIDE the DB tx (idempotency key = refund.id), then flips
 * the refund to 'succeeded' / 'failed' in a follow-up tx. On full refund
 * coverage the order transitions to 'refunded' (emits `order.refunded`).
 */

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createRefund } from '@/modules/orders/refund';
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
            amountCents: z.number().int().positive(),
          })
          .strict(),
      )
      .min(1),
    reason: z.string().min(1).optional(),
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
      'Invalid refund body',
      validated.error.issues.map(i => ({
        path: i.path.map(p => String(p)),
        message: i.message,
      })),
    );
  }

  try {
    const result = await withIdempotency(
      `admin:orders:refund:${pipeline.storeId}:${id}`,
      pipeline.idempotencyKey!,
      async () =>
        createRefund(pipeline.storeId, {
          orderId: id,
          items: validated.data.items,
          ...(validated.data.reason !== undefined ? { reason: validated.data.reason } : {}),
          actor: { actorType: 'admin', actorId: pipeline.session.userId },
        }),
    );
    return NextResponse.json({ data: result }, { status: 201 });
  } catch (err) {
    return mapOrderError(err);
  }
}
