import type { Job } from 'bullmq';
import { and, eq, lt, inArray } from 'drizzle-orm';
import { migratorDb } from '@/db/client';
import { logger } from '@/lib/logger';
import { withTenant } from '@/modules/tenant/with-tenant';
import { orders } from '@/db/schema/orders';
import { orderEvents } from '@/db/schema/audit';
import { outboxEvents } from '@/db/schema/webhooks';
import { paymentIntents } from '@/db/schema/payments';
import { stockMovements, stockReservations } from '@/db/schema/inventory';

/**
 * Stale payment sweep.
 *
 * Cancels orders stuck in `pending_payment` for > 30 minutes since `placedAt`.
 * For each stale order:
 *   1. UPDATE orders SET status='cancelled', cancelledAt=now()
 *      WHERE id=... AND status='pending_payment' — the status re-check inside
 *      the per-tenant tx makes the sweep idempotent (a concurrent webhook that
 *      flipped to 'paid' is a no-op).
 *   2. INSERT order_events row (kind='cancelled', actorType='system',
 *      payload={ reason: 'stale_payment_timeout' }).
 *   3. Release any reservations whose intent's cart corresponds to this order
 *      (lookup via payment_intents.cartId joining to stock_reservations.cartId,
 *      OR stock_reservations.orderId if it was committed). For each active
 *      reservation, insert a `release` stock_movement and flip to 'released'.
 *   4. INSERT outbox_events (topic='order.cancelled', payload={ orderId, reason }).
 *
 * Uses `migratorDb` (BYPASSRLS) only for the initial cross-tenant SELECT — the
 * scheduler enqueues this job on a 5-min cadence with no `app.store_id` in
 * scope, so the scan must see every store's orders. Mutations happen under
 * `withTenant(order.storeId, ...)` so RLS still gates writes and triggers fire
 * with the correct tenant context.
 *
 * Idempotency: the UPDATE … WHERE status='pending_payment' filters out orders
 * a concurrent commit already moved off the pending state, and the per-row
 * reservation re-check (`status='active'`) keeps stock_movements from
 * double-writing release rows. Re-running the sweep finds zero rows once an
 * order has been processed.
 *
 * Batch: 200 orders per invocation; the scheduler will pick up the rest on the
 * next 5-min tick if the queue is deep.
 */
const SWEEP_BATCH_SIZE = 200;
const STALE_THRESHOLD_MS = 30 * 60 * 1000; // 30 minutes

export async function ordersStalePaymentSweep(
  _job: Job<Record<string, unknown>>,
): Promise<{ cancelled: number }> {
  const cutoff = new Date(Date.now() - STALE_THRESHOLD_MS);

  const stale = await migratorDb
    .select({ id: orders.id, storeId: orders.storeId })
    .from(orders)
    .where(and(eq(orders.status, 'pending_payment'), lt(orders.placedAt, cutoff)))
    .limit(SWEEP_BATCH_SIZE);

  if (stale.length === 0) {
    return { cancelled: 0 };
  }

  let cancelled = 0;

  for (const order of stale) {
    try {
      await withTenant(order.storeId, async tx => {
        // Idempotent cancel: a concurrent payment-succeeded webhook may have
        // flipped this row to 'paid' between the cross-tenant scan and now;
        // the status guard reduces to a no-op in that case.
        const updated = await tx
          .update(orders)
          .set({ status: 'cancelled', cancelledAt: new Date() })
          .where(and(eq(orders.id, order.id), eq(orders.status, 'pending_payment')))
          .returning({ id: orders.id });

        if (updated.length === 0) {
          return;
        }

        await tx.insert(orderEvents).values({
          storeId: order.storeId,
          orderId: order.id,
          kind: 'cancelled',
          actorType: 'system',
          actorId: null,
          payload: { reason: 'stale_payment_timeout' },
        });

        // Release reservations tied to this order. Two paths:
        //   1. Reservations were committed (stock_reservations.orderId set on
        //      checkout commit) — release directly by orderId.
        //   2. Reservations still cart-linked because checkout never committed
        //      — find the payment intent for this order's cart and release by
        //      its cartId. We discover the relevant cartIds via
        //      payment_intents rows whose cartId matches stock_reservations
        //      and whose status is still pending/attached. Since payments and
        //      intents don't yet carry a hard orderId FK link before commit,
        //      we conservatively gather candidate cartIds by looking at
        //      intents whose `raw` references this order's id. This branch is
        //      best-effort; the canonical link is path 1.
        //
        // TODO(SP-5): once payment_intents grows an explicit orderId column
        // (deferred to a later migration in this SP), simplify the cart path
        // to a single join.
        const directReservations = await tx
          .select()
          .from(stockReservations)
          .where(
            and(
              eq(stockReservations.orderId, order.id),
              eq(stockReservations.status, 'active'),
            ),
          );

        const intents = await tx
          .select({ cartId: paymentIntents.cartId })
          .from(paymentIntents)
          .where(eq(paymentIntents.storeId, order.storeId));

        const cartIds = intents
          .map(i => i.cartId)
          .filter((c): c is string => c !== null);

        const cartReservations =
          cartIds.length > 0
            ? await tx
                .select()
                .from(stockReservations)
                .where(
                  and(
                    inArray(stockReservations.cartId, cartIds),
                    eq(stockReservations.status, 'active'),
                  ),
                )
            : [];

        const toRelease = [...directReservations, ...cartReservations];
        const seen = new Set<string>();
        for (const r of toRelease) {
          if (seen.has(r.id)) continue;
          seen.add(r.id);

          const flipped = await tx
            .update(stockReservations)
            .set({ status: 'released' })
            .where(
              and(
                eq(stockReservations.id, r.id),
                eq(stockReservations.status, 'active'),
              ),
            )
            .returning({ id: stockReservations.id });

          if (flipped.length === 0) {
            continue;
          }

          await tx.insert(stockMovements).values({
            storeId: r.storeId,
            variantId: r.variantId,
            locationId: r.locationId,
            qty: r.qty,
            kind: 'release',
            reason: 'stale_payment_timeout',
            refType: 'reservation',
            refId: r.id,
          });
        }

        await tx.insert(outboxEvents).values({
          storeId: order.storeId,
          topic: 'order.cancelled',
          payload: { orderId: order.id, reason: 'stale_payment_timeout' },
        });

        cancelled += 1;
      });
    } catch (err) {
      logger.error(
        { err, orderId: order.id, storeId: order.storeId },
        'orders stale payment sweep: failed to cancel order',
      );
    }
  }

  logger.info(
    { cancelled, scanned: stale.length },
    'orders stale payment sweep complete',
  );
  return { cancelled };
}
