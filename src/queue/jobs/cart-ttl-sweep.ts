import type { Job } from 'bullmq';
import { and, eq, isNotNull, lt } from 'drizzle-orm';
import { migratorDb } from '@/db/client';
import { carts } from '@/db/schema/carts';
import { stockMovements, stockReservations } from '@/db/schema/inventory';
import { logger } from '@/lib/logger';

/**
 * Cart TTL sweep.
 *
 * Iterates carts whose `expires_at` has passed and:
 *  1. for each active reservation tied to the cart, inserts a `release`
 *     stock_movement (the AFTER INSERT trigger on stock_movements decrements
 *     `stock_levels.reserved` accordingly) and flips the reservation row to
 *     `status = 'released'`.
 *  2. deletes the cart row (cart_items cascade via FK).
 *
 * Uses `migratorDb` (BYPASSRLS) on purpose: this is a cross-tenant maintenance
 * job — the scheduler enqueues it every 6h regardless of any HTTP request, so
 * there is no `app.store_id` setting in scope. The sweep must be able to scan
 * every store's carts and write rows on each store's behalf. Same justification
 * as `reservation-ttl-sweep.ts`.
 *
 * Idempotency: the WHERE clause `expires_at < now()` and per-reservation
 * `status = 'active'` re-check ensure a re-run finds zero rows once a cart has
 * been swept — the cart is deleted and its reservations flipped, so subsequent
 * sweeps skip them. Batched at 500 carts per invocation; the scheduler will
 * pick up the rest on the next 6h tick (or sooner if the queue is drained).
 */
const SWEEP_BATCH_SIZE = 500;

export async function cartTtlSweep(
  _job: Job<Record<string, unknown>>,
): Promise<{ sweeptCarts: number; releasedReservations: number }> {
  const now = new Date();
  const expired = await migratorDb
    .select({ id: carts.id, storeId: carts.storeId })
    .from(carts)
    .where(lt(carts.expiresAt, now))
    .limit(SWEEP_BATCH_SIZE);

  if (expired.length === 0) {
    return { sweeptCarts: 0, releasedReservations: 0 };
  }

  let sweeptCarts = 0;
  let releasedReservations = 0;

  for (const cart of expired) {
    try {
      await migratorDb.transaction(async tx => {
        // Fetch active reservations tied to this cart. We do this inside the
        // transaction so a concurrent commit (checkout flipped a reservation
        // to 'committed' since we started) is naturally excluded by the
        // per-row status re-check below.
        const reservations = await tx
          .select()
          .from(stockReservations)
          .where(
            and(
              isNotNull(stockReservations.cartId),
              eq(stockReservations.cartId, cart.id),
              eq(stockReservations.status, 'active'),
            ),
          );

        for (const r of reservations) {
          const updated = await tx
            .update(stockReservations)
            .set({ status: 'released' })
            .where(
              and(
                eq(stockReservations.id, r.id),
                eq(stockReservations.status, 'active'),
              ),
            )
            .returning({ id: stockReservations.id });

          if (updated.length === 0) {
            continue;
          }

          await tx.insert(stockMovements).values({
            storeId: r.storeId,
            variantId: r.variantId,
            locationId: r.locationId,
            qty: r.qty,
            kind: 'release',
            reason: 'cart_expired',
            refType: 'reservation',
            refId: r.id,
          });

          releasedReservations += 1;
        }

        // Cart row goes last so cascade delete of cart_items happens after
        // reservations are unwound. Idempotent: the next sweep will not see
        // this cart again.
        const deleted = await tx
          .delete(carts)
          .where(eq(carts.id, cart.id))
          .returning({ id: carts.id });

        if (deleted.length > 0) {
          sweeptCarts += 1;
        }
      });
    } catch (err) {
      logger.error(
        { err, cartId: cart.id, storeId: cart.storeId },
        'cart ttl sweep: failed to sweep cart',
      );
    }
  }

  logger.info(
    { sweeptCarts, releasedReservations, scanned: expired.length },
    'cart ttl sweep complete',
  );
  return { sweeptCarts, releasedReservations };
}
