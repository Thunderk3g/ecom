/**
 * Inventory availability reads.
 *
 * `checkAvailability` is the storefront-facing query. It applies a **lazy expiry**
 * rule: reservations whose `status='active'` but whose `expires_at < now()` are
 * treated as already-released (the TTL sweep just hasn't run yet). Their `qty` is
 * added back to the materialized `available` so the storefront never under-reports
 * stock between sweep runs.
 *
 * `getPooledAvailable` sums available across all locations for a variant — used
 * when `site_config.inventory.pooled_availability = true`.
 *
 * `isLow` is a helper for the storefront `low: boolean` flag (no raw counts leak).
 */

import { and, eq, lt, sql } from 'drizzle-orm';
import { withTenant } from '@/modules/tenant/with-tenant';
import { stockLevels, stockReservations, stockThresholds } from '@/db/schema/inventory';

export interface AvailabilityResult {
  available: number;
  canFulfill: boolean;
}

export async function checkAvailability(
  storeId: string,
  variantId: string,
  locationId: string,
  requestedQty: number,
): Promise<AvailabilityResult> {
  return withTenant(storeId, async tx => {
    const [level] = await tx
      .select({
        onHand: stockLevels.onHand,
        reserved: stockLevels.reserved,
      })
      .from(stockLevels)
      .where(and(eq(stockLevels.variantId, variantId), eq(stockLevels.locationId, locationId)));

    if (!level) {
      return { available: 0, canFulfill: requestedQty <= 0 };
    }

    // Lazy expiry: reservations marked active but whose TTL has passed will be
    // released by the next sweep — surface them as already-free for storefront reads.
    const [stale] = await tx
      .select({
        staleQty: sql<number>`coalesce(sum(${stockReservations.qty}), 0)::int`,
      })
      .from(stockReservations)
      .where(
        and(
          eq(stockReservations.variantId, variantId),
          eq(stockReservations.locationId, locationId),
          eq(stockReservations.status, 'active'),
          lt(stockReservations.expiresAt, new Date()),
        ),
      );

    const staleQty = stale?.staleQty ?? 0;
    const materializedAvailable = level.onHand - level.reserved;
    const liveAvailable = materializedAvailable + staleQty;

    return {
      available: liveAvailable,
      canFulfill: liveAvailable >= requestedQty,
    };
  });
}

/**
 * Pooled availability: sum of (on_hand - reserved) across every location, with
 * the same lazy-expiry adjustment.
 */
export async function getPooledAvailable(storeId: string, variantId: string): Promise<number> {
  return withTenant(storeId, async tx => {
    const [row] = await tx
      .select({
        sum: sql<number>`coalesce(sum(${stockLevels.onHand} - ${stockLevels.reserved}), 0)::int`,
      })
      .from(stockLevels)
      .where(eq(stockLevels.variantId, variantId));

    const [stale] = await tx
      .select({
        staleQty: sql<number>`coalesce(sum(${stockReservations.qty}), 0)::int`,
      })
      .from(stockReservations)
      .where(
        and(
          eq(stockReservations.variantId, variantId),
          eq(stockReservations.status, 'active'),
          lt(stockReservations.expiresAt, new Date()),
        ),
      );

    return (row?.sum ?? 0) + (stale?.staleQty ?? 0);
  });
}

/**
 * Helper used by the storefront `availability` endpoint to compute the `low`
 * boolean without leaking raw counts. Returns true when a threshold exists and
 * the live available is at-or-below the reorder point.
 *
 * Pass `currentAvailable` if it was already computed by `checkAvailability` to
 * avoid a redundant level lookup.
 */
export async function isLow(
  storeId: string,
  variantId: string,
  locationId: string,
  currentAvailable?: number,
): Promise<boolean> {
  return withTenant(storeId, async tx => {
    const [threshold] = await tx
      .select({ reorderPoint: stockThresholds.reorderPoint })
      .from(stockThresholds)
      .where(
        and(eq(stockThresholds.variantId, variantId), eq(stockThresholds.locationId, locationId)),
      );

    if (!threshold) return false;

    let avail = currentAvailable;
    if (avail === undefined) {
      const [level] = await tx
        .select({
          onHand: stockLevels.onHand,
          reserved: stockLevels.reserved,
        })
        .from(stockLevels)
        .where(
          and(eq(stockLevels.variantId, variantId), eq(stockLevels.locationId, locationId)),
        );
      avail = level ? level.onHand - level.reserved : 0;
    }

    return avail <= threshold.reorderPoint;
  });
}
