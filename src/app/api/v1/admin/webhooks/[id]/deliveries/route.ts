/**
 * GET /api/v1/admin/webhooks/[id]/deliveries
 *
 * Cursor-paginated read of delivery attempts for a single subscription.
 * Optional `?status=` filter accepts `pending`, `succeeded`, `failed`, or
 * `dead` — the admin UI's dead-letter view passes `status=dead`.
 */

import { NextResponse } from 'next/server';
import {
  listDeliveries,
  type WebhookDeliveryStatus,
} from '@/modules/webhooks/subscriptions';
import { mapWebhookError, runAdminPipeline } from '../../_lib';

const DELIVERY_STATUSES: readonly WebhookDeliveryStatus[] = [
  'pending',
  'succeeded',
  'failed',
  'dead',
];

type RouteCtx = { params: Promise<{ id: string }> };

export async function GET(req: Request, ctx: RouteCtx): Promise<NextResponse> {
  const pipeline = await runAdminPipeline(req, {
    requireMutation: false,
    permission: 'webhooks:read',
  });
  if (!pipeline.ok) return pipeline.response;

  const { id } = await ctx.params;
  const url = new URL(req.url);
  const cursor = url.searchParams.get('after') ?? undefined;
  const limitRaw = url.searchParams.get('limit');
  const statusRaw = url.searchParams.get('status');
  const status =
    statusRaw && (DELIVERY_STATUSES as readonly string[]).includes(statusRaw)
      ? (statusRaw as WebhookDeliveryStatus)
      : undefined;

  try {
    const result = await listDeliveries(pipeline.storeId, id, {
      ...(cursor !== undefined ? { cursor } : {}),
      ...(limitRaw ? { limit: Number.parseInt(limitRaw, 10) } : {}),
      ...(status !== undefined ? { status } : {}),
    });
    return NextResponse.json({
      data: result.items,
      page: { nextCursor: result.nextCursor },
    });
  } catch (err) {
    return mapWebhookError(err);
  }
}
