/**
 * POST /api/v1/admin/orders/[id]/cancel
 *
 * Body: { reason? } — body is optional, only parsed when Content-Length > 0.
 *
 * Transitions the order to 'cancelled' via `transitionOrder`. Invalid hops
 * (terminal state) surface as 409 invalid-order-transition.
 */

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { transitionOrder } from '@/modules/orders/lifecycle';
import { problem } from '@/lib/errors';
import { withIdempotency } from '@/lib/idempotency';
import { mapOrderError, readJsonBody, runAdminPipeline } from '../../_lib';

const bodySchema = z
  .object({
    reason: z.string().min(1).optional(),
  })
  .strict()
  .optional();

type RouteCtx = { params: Promise<{ id: string }> };

export async function POST(req: Request, ctx: RouteCtx): Promise<NextResponse> {
  const pipeline = await runAdminPipeline(req, {
    requireMutation: true,
    permission: 'orders:write',
  });
  if (!pipeline.ok) return pipeline.response;

  const { id } = await ctx.params;

  let reason: string | undefined;
  const contentLength = req.headers.get('content-length');
  if (contentLength && contentLength !== '0') {
    const parsed = await readJsonBody(req);
    if (!parsed.ok) return parsed.response;
    const validated = bodySchema.safeParse(parsed.data);
    if (!validated.success) {
      return problem(
        422,
        'invalid-body',
        'Invalid cancel body',
        validated.error.issues.map(i => ({
          path: i.path.map(p => String(p)),
          message: i.message,
        })),
      );
    }
    reason = validated.data?.reason;
  }

  try {
    const result = await withIdempotency(
      `admin:orders:cancel:${pipeline.storeId}:${id}`,
      pipeline.idempotencyKey!,
      async () =>
        transitionOrder(
          pipeline.storeId,
          id,
          'cancelled',
          { actorType: 'admin', actorId: pipeline.session.userId },
          reason !== undefined ? { reason } : {},
        ),
    );
    return NextResponse.json({ data: result });
  } catch (err) {
    return mapOrderError(err);
  }
}
