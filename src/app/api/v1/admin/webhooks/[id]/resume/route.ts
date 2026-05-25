/**
 * POST /api/v1/admin/webhooks/[id]/resume
 *
 * Flip a subscription back to `status='active'`. Idempotent at the service
 * layer: resuming an already-active webhook is a no-op.
 */

import { NextResponse } from 'next/server';
import { resumeWebhook } from '@/modules/webhooks/subscriptions';
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
      `admin:webhooks:resume:${pipeline.storeId}:${id}`,
      pipeline.idempotencyKey!,
      async () => resumeWebhook(pipeline.storeId, id),
    );
    return NextResponse.json({ data: webhook });
  } catch (err) {
    return mapWebhookError(err);
  }
}
