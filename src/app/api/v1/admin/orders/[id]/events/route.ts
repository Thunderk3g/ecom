/**
 * GET /api/v1/admin/orders/[id]/events
 *
 * Returns the append-only order timeline (oldest-first). RLS scopes to the
 * resolved tenant. An empty array means either no events or no visibility —
 * the route does not distinguish (callers can GET the order detail first
 * if they need a 404 signal).
 */

import { NextResponse } from 'next/server';
import { getOrderTimeline } from '@/modules/orders/events';
import { mapOrderError, runAdminPipeline } from '../../_lib';

type RouteCtx = { params: Promise<{ id: string }> };

export async function GET(req: Request, ctx: RouteCtx): Promise<NextResponse> {
  const pipeline = await runAdminPipeline(req, {
    requireMutation: false,
    permission: 'orders:read',
  });
  if (!pipeline.ok) return pipeline.response;

  const { id } = await ctx.params;

  try {
    const events = await getOrderTimeline(pipeline.storeId, id);
    return NextResponse.json({ data: events });
  } catch (err) {
    return mapOrderError(err);
  }
}
