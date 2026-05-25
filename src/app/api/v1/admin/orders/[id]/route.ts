/**
 * GET /api/v1/admin/orders/[id]
 *
 * Returns the admin order detail bundle: order row + items + payment(s) +
 * latest payment intent + append-only timeline. RLS scopes everything to
 * the resolved tenant via `withTenant`.
 */

import { NextResponse } from 'next/server';
import { desc, eq } from 'drizzle-orm';
import { withTenant } from '@/modules/tenant/with-tenant';
import { orders, orderItems } from '@/db/schema/orders';
import { payments, paymentIntents } from '@/db/schema/payments';
import { getOrderTimeline } from '@/modules/orders/events';
import { OrderNotFoundError } from '@/modules/orders/errors';
import { mapOrderError, runAdminPipeline } from '../_lib';

type RouteCtx = { params: Promise<{ id: string }> };

export async function GET(req: Request, ctx: RouteCtx): Promise<NextResponse> {
  const pipeline = await runAdminPipeline(req, {
    requireMutation: false,
    permission: 'orders:read',
  });
  if (!pipeline.ok) return pipeline.response;

  const { id } = await ctx.params;

  try {
    const bundle = await withTenant(pipeline.storeId, async tx => {
      const [order] = await tx.select().from(orders).where(eq(orders.id, id)).limit(1);
      if (!order) throw new OrderNotFoundError(id);

      const items = await tx
        .select()
        .from(orderItems)
        .where(eq(orderItems.orderId, id));

      const paymentRows = await tx
        .select()
        .from(payments)
        .where(eq(payments.orderId, id))
        .orderBy(desc(payments.createdAt));

      // Resolve the most recent intent through the first payment (if any) or
      // by direct lookup when no payment row exists yet.
      let intent: typeof paymentIntents.$inferSelect | null = null;
      const headPayment = paymentRows[0];
      if (headPayment?.intentId) {
        const [row] = await tx
          .select()
          .from(paymentIntents)
          .where(eq(paymentIntents.id, headPayment.intentId))
          .limit(1);
        intent = row ?? null;
      }

      return { order, items, payments: paymentRows, intent };
    });

    const timeline = await getOrderTimeline(pipeline.storeId, id);

    return NextResponse.json({
      data: {
        order: bundle.order,
        items: bundle.items,
        payments: bundle.payments,
        intent: bundle.intent,
        timeline,
      },
    });
  } catch (err) {
    return mapOrderError(err);
  }
}
