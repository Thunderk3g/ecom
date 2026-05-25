import type { Job } from 'bullmq';
import { and, eq, lt } from 'drizzle-orm';
import { migratorDb } from '@/db/client';
import { stockMovements, stockReservations } from '@/db/schema/inventory';
import { logger } from '@/lib/logger';

/**
 * Reservation TTL sweep.
 *
 * Iterates active reservations whose `expires_at` has passed and:
 *  1. inserts a `release` movement (the AFTER INSERT trigger on stock_movements
 *     decrements `stock_levels.reserved` accordingly).
 *  2. flips the reservation row to `status = 'expired'`.
 *
 * Uses `migratorDb` (BYPASSRLS) on purpose: this is a cross-tenant maintenance
 * job — the scheduler enqueues it every 60s regardless of any HTTP request, so
 * there is no `app.store_id` setting in scope. The sweep must be able to scan
 * every store's reservations and write rows on each store's behalf.
 *
 * Idempotency: the WHERE clause `status = 'active' AND expires_at < now()`
 * ensures a re-run finds zero rows once a reservation has been processed —
 * each release transaction flips the status, so subsequent sweeps skip it.
 * Batched at 1000 rows per invocation; the scheduler will pick up the rest
 * on the next 60s tick if the queue is deep.
 */
const SWEEP_BATCH_SIZE = 1000;

export async function reservationTtlSweep(
  _job: Job<Record<string, unknown>>,
): Promise<{ released: number }> {
  const now = new Date();
  const expired = await migratorDb
    .select()
    .from(stockReservations)
    .where(
      and(
        eq(stockReservations.status, 'active'),
        lt(stockReservations.expiresAt, now),
      ),
    )
    .limit(SWEEP_BATCH_SIZE);

  if (expired.length === 0) {
    return { released: 0 };
  }

  let released = 0;
  for (const r of expired) {
    try {
      await migratorDb.transaction(async tx => {
        // Re-check status inside the transaction so a concurrent commit (cart
        // checkout flipped the same row to 'committed' since we read it) is a
        // no-op for the sweep.
        const updated = await tx
          .update(stockReservations)
          .set({ status: 'expired' })
          .where(
            and(
              eq(stockReservations.id, r.id),
              eq(stockReservations.status, 'active'),
            ),
          )
          .returning({ id: stockReservations.id });

        if (updated.length === 0) {
          return;
        }

        await tx.insert(stockMovements).values({
          storeId: r.storeId,
          variantId: r.variantId,
          locationId: r.locationId,
          qty: r.qty,
          kind: 'release',
          reason: 'ttl_expired',
          refType: 'reservation',
          refId: r.id,
        });

        released += 1;
      });
    } catch (err) {
      logger.error(
        { err, reservationId: r.id, storeId: r.storeId },
        'reservation ttl sweep: failed to release reservation',
      );
    }
  }

  logger.info({ released, scanned: expired.length }, 'reservation ttl sweep complete');
  return { released };
}
