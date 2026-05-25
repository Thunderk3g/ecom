/**
 * Inventory reservations: reserve, release, commit.
 *
 * Concurrency contract:
 *   `reserve` opens a `withTenant` transaction, takes a row-level lock on the
 *   target `stock_levels` row via `SELECT ... FOR UPDATE`, validates available
 *   stock, then inserts the movement and reservation rows. The 0010 AFTER INSERT
 *   trigger on `stock_movements` maintains `stock_levels.reserved`. Two concurrent
 *   reservations for the same (variant, location) serialize on the FOR UPDATE lock,
 *   so one observes the other's increment before deciding to fail.
 *
 *   `release` and `commit` both flip the reservation row and append the
 *   appropriate compensating movement(s) in the SAME transaction.
 *
 * Append-only ledger: never UPDATE/DELETE `stock_movements`; the 0009 RLS policies
 * actively block both. Status flips on `stock_reservations` are the only state
 * change.
 */

import { and, eq, inArray } from 'drizzle-orm';
import { withTenant } from '@/modules/tenant/with-tenant';
import { stockLevels, stockMovements, stockReservations } from '@/db/schema/inventory';
import {
  InsufficientStockError,
  ReservationNotActiveError,
  ReservationNotFoundError,
} from './errors';

export interface ReserveItem {
  variantId: string;
  locationId: string;
  qty: number;
}

export interface ReserveInput {
  cartId: string;
  items: ReserveItem[];
  /** Reservation TTL in seconds. Defaults to 15 minutes. */
  ttlSeconds?: number;
}

export interface ReserveResult {
  reservationIds: string[];
  expiresAt: Date;
}

const DEFAULT_TTL_SECONDS = 15 * 60;

export async function reserve(storeId: string, input: ReserveInput): Promise<ReserveResult> {
  const ttl = input.ttlSeconds ?? DEFAULT_TTL_SECONDS;
  const expiresAt = new Date(Date.now() + ttl * 1000);

  return withTenant(storeId, async tx => {
    const reservationIds: string[] = [];

    for (const item of input.items) {
      if (item.qty <= 0) {
        throw new InsufficientStockError(item.variantId, item.locationId, item.qty, 0);
      }

      // Row-lock the stock_levels row so concurrent reservers serialize here.
      // `FOR UPDATE` blocks other transactions until ours commits/rolls back.
      const [locked] = await tx
        .select({
          onHand: stockLevels.onHand,
          reserved: stockLevels.reserved,
        })
        .from(stockLevels)
        .where(
          and(
            eq(stockLevels.variantId, item.variantId),
            eq(stockLevels.locationId, item.locationId),
          ),
        )
        .for('update');

      const onHand = locked?.onHand ?? 0;
      const reserved = locked?.reserved ?? 0;
      const available = onHand - reserved;

      if (available < item.qty) {
        throw new InsufficientStockError(item.variantId, item.locationId, item.qty, available);
      }

      // Append movement (reservation kind). The 0010 trigger increments reserved.
      await tx.insert(stockMovements).values({
        storeId,
        variantId: item.variantId,
        locationId: item.locationId,
        qty: item.qty,
        kind: 'reservation',
        reason: 'cart_reserve',
        refType: 'cart',
        refId: input.cartId,
      });

      const [row] = await tx
        .insert(stockReservations)
        .values({
          storeId,
          variantId: item.variantId,
          locationId: item.locationId,
          qty: item.qty,
          cartId: input.cartId,
          expiresAt,
          status: 'active',
        })
        .returning({ id: stockReservations.id });

      if (!row) {
        throw new Error('reservation insert returned no row');
      }
      reservationIds.push(row.id);
    }

    return { reservationIds, expiresAt };
  });
}

/**
 * Release an active reservation. Appends a `release` movement (trigger decrements
 * `stock_levels.reserved`) and flips `status` to 'released'. No-ops idempotently
 * if the reservation is already non-active (per the assumption that the TTL sweep
 * and manual admin release may race).
 */
export async function release(
  storeId: string,
  reservationId: string,
  reason: string = 'cart_abandoned',
): Promise<void> {
  return withTenant(storeId, async tx => {
    const [r] = await tx
      .select()
      .from(stockReservations)
      .where(eq(stockReservations.id, reservationId));

    if (!r) throw new ReservationNotFoundError(reservationId);
    if (r.status !== 'active') {
      // Idempotent: silently ignore non-active reservations (sweep may have won).
      return;
    }

    await tx.insert(stockMovements).values({
      storeId,
      variantId: r.variantId,
      locationId: r.locationId,
      qty: r.qty,
      kind: 'release',
      reason,
      refType: 'reservation',
      refId: r.id,
    });

    await tx
      .update(stockReservations)
      .set({ status: 'released' })
      .where(and(eq(stockReservations.id, r.id), eq(stockReservations.status, 'active')));
  });
}

/**
 * Commit reservations to an order. For each reservation, in one tx:
 *   1. Append a `release` movement (frees the `reserved` count).
 *   2. Append an `outbound` movement against the order (decrements `on_hand`).
 *   3. Flip reservation status to 'committed' and pin `order_id`.
 *
 * Net effect on `stock_levels`: reserved -= qty, on_hand -= qty.
 */
export async function commit(
  storeId: string,
  reservationIds: string[],
  orderId: string,
): Promise<void> {
  if (reservationIds.length === 0) return;

  return withTenant(storeId, async tx => {
    const rows = await tx
      .select()
      .from(stockReservations)
      .where(inArray(stockReservations.id, reservationIds))
      .for('update');

    const byId = new Map(rows.map(r => [r.id, r]));
    for (const id of reservationIds) {
      const r = byId.get(id);
      if (!r) throw new ReservationNotFoundError(id);
      if (r.status !== 'active') throw new ReservationNotActiveError(id, r.status);
    }

    for (const r of rows) {
      await tx.insert(stockMovements).values({
        storeId,
        variantId: r.variantId,
        locationId: r.locationId,
        qty: r.qty,
        kind: 'release',
        reason: 'order_commit',
        refType: 'reservation',
        refId: r.id,
      });

      await tx.insert(stockMovements).values({
        storeId,
        variantId: r.variantId,
        locationId: r.locationId,
        // Outbound qty is conventionally negative in the ledger; the 0010 trigger
        // maps `outbound` kind to `delta_on_hand := -NEW.qty`, so we pass positive
        // qty here and let the trigger negate it.
        qty: r.qty,
        kind: 'outbound',
        reason: 'order_fulfilled',
        refType: 'order',
        refId: orderId,
      });

      await tx
        .update(stockReservations)
        .set({ status: 'committed', orderId })
        .where(eq(stockReservations.id, r.id));
    }

  });
}
