/**
 * GET    /api/v1/admin/webhooks/[id]   — fetch a single subscription
 * PATCH  /api/v1/admin/webhooks/[id]   — update url/secret/topics/status
 * DELETE /api/v1/admin/webhooks/[id]   — remove a subscription (cascade
 *                                        cleanup handled at the DB layer)
 */

import { NextResponse } from 'next/server';
import { z } from 'zod';
import {
  deleteWebhook,
  getWebhook,
  updateWebhook,
} from '@/modules/webhooks/subscriptions';
import { problem } from '@/lib/errors';
import { withIdempotency } from '@/lib/idempotency';
import { mapWebhookError, readJsonBody, runAdminPipeline } from '../_lib';

const patchBody = z.object({
  url: z.string().url().optional(),
  secret: z.string().min(1).optional(),
  topics: z.array(z.string().min(1)).min(1).optional(),
  status: z.enum(['active', 'paused']).optional(),
});

type RouteCtx = { params: Promise<{ id: string }> };

export async function GET(req: Request, ctx: RouteCtx): Promise<NextResponse> {
  const pipeline = await runAdminPipeline(req, {
    requireMutation: false,
    permission: 'webhooks:read',
  });
  if (!pipeline.ok) return pipeline.response;

  const { id } = await ctx.params;
  try {
    const webhook = await getWebhook(pipeline.storeId, id);
    return NextResponse.json({ data: webhook });
  } catch (err) {
    return mapWebhookError(err);
  }
}

export async function PATCH(req: Request, ctx: RouteCtx): Promise<NextResponse> {
  const pipeline = await runAdminPipeline(req, {
    requireMutation: true,
    permission: 'webhooks:write',
  });
  if (!pipeline.ok) return pipeline.response;

  const { id } = await ctx.params;
  const parsed = await readJsonBody(req);
  if (!parsed.ok) return parsed.response;
  const validated = patchBody.safeParse(parsed.data);
  if (!validated.success) {
    return problem(
      422,
      'invalid-body',
      'Invalid webhook patch',
      validated.error.issues.map(i => ({ path: i.path.map(p => String(p)), message: i.message })),
    );
  }

  try {
    const updated = await withIdempotency(
      `admin:webhooks:patch:${pipeline.storeId}:${id}`,
      pipeline.idempotencyKey!,
      async () =>
        updateWebhook(pipeline.storeId, id, {
          ...(validated.data.url !== undefined ? { url: validated.data.url } : {}),
          ...(validated.data.secret !== undefined ? { secret: validated.data.secret } : {}),
          ...(validated.data.topics !== undefined ? { topics: validated.data.topics } : {}),
          ...(validated.data.status !== undefined ? { status: validated.data.status } : {}),
        }),
    );
    return NextResponse.json({ data: updated });
  } catch (err) {
    return mapWebhookError(err);
  }
}

export async function DELETE(req: Request, ctx: RouteCtx): Promise<NextResponse> {
  const pipeline = await runAdminPipeline(req, {
    requireMutation: true,
    permission: 'webhooks:write',
  });
  if (!pipeline.ok) return pipeline.response;

  const { id } = await ctx.params;
  try {
    await withIdempotency(
      `admin:webhooks:delete:${pipeline.storeId}:${id}`,
      pipeline.idempotencyKey!,
      async () => {
        await deleteWebhook(pipeline.storeId, id);
        return { deleted: true } as const;
      },
    );
    return new NextResponse(null, { status: 204 });
  } catch (err) {
    return mapWebhookError(err);
  }
}
