/**
 * POST /api/v1/admin/webhooks/[id]/pause
 *
 * Flip a subscription to `status='paused'`. Idempotent at the service layer:
 * pausing an already-paused webhook is a no-op and returns the current row.
 */

import { NextResponse } from 'next/server';
import { pauseWebhook } from '@/modules/webhooks/subscriptions';
import { withIdempotency } from '@/lib/idempotency';
import { mapWebhookError, runAdminPipeline } from '../../_lib';

type RouteCtx = { params: Promise<{ id: string }> };

export async function POST(req: Request, ctx: RouteCtx): Promise<NextResponse> {
  const pipeline = await runAdminPipeline(req, {
    requireMutation: true,
    permission: 'webhooks:write',
  });
  if (!pipeline.ok) return pipeline.response;

  const { id } = await ctx.params;
  try {
    const webhook = await withIdempotency(
      `admin:webhooks:pause:${pipeline.storeId}:${id}`,
      pipeline.idempotencyKey!,
      async () => pauseWebhook(pipeline.storeId, id),
    );
    return NextResponse.json({ data: webhook });
  } catch (err) {
    return mapWebhookError(err);
  }
}
