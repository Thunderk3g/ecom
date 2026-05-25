/**
 * Storefront customer order detail.
 *
 * GET /api/v1/customer/orders/:number
 *
 * Looks up the order by its human-facing `number` within the current tenant
 * and verifies the order belongs to the authenticated customer. A mismatch
 * (or missing row) renders 404 — never 403 — so we don't leak whether the
 * order number exists for a different customer.
 *
 * Response shape: `{ data: OrderWithItems }` where items are the snapshotted
 * `order_items` rows.
 */

import { NextResponse } from 'next/server';
import { getOrderByNumber } from '@/modules/checkout/orders';
import { problem } from '@/lib/errors';
import { resolveTenantAndCustomerSession } from '../../_lib';

type Params = { number: string };

export async function GET(
  req: Request,
  ctx: { params: Promise<Params> },
): Promise<NextResponse> {
  const resolved = await resolveTenantAndCustomerSession(req);
  if (!resolved.ok) return resolved.response;
  const { ctx: cctx } = resolved;

  const { number } = await ctx.params;
  if (!number) {
    return problem(400, 'invalid-path', 'order number is required', [
      { path: ['number'], message: 'required' },
    ]);
  }

  const order = await getOrderByNumber(cctx.storeId, number);
  if (!order || order.customerId !== cctx.customer.id) {
    return problem(404, 'order-not-found', `Order not found: ${number}`, []);
  }

  return NextResponse.json({ data: order });
}
