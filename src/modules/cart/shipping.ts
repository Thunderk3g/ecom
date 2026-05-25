/**
 * Shipping computation.
 *
 * `computeShipping` matches the cart's shipping address against shipping_zones
 * for the store, picks a rate (by code when supplied, otherwise the first
 * eligible), then applies free-over thresholds.
 *
 *   1. zone.regions[] matched in order; first matching zone wins.
 *   2. If no zone matches but a default zone exists (isDefault), use it.
 *   3. rateCode picks a named rate (`standard`, `express`, ...); otherwise the
 *      first rate whose min/max order window contains the cart subtotal.
 *   4. rate.freeOverCents takes priority over zone.freeOverCents.
 *
 * No address → returns 0 cents and no option. Callers may treat that as
 * "shipping not calculable yet" (cart preview before address entry).
 */

import { eq } from 'drizzle-orm';
import type { PostgresJsTransaction } from 'drizzle-orm/postgres-js';
import { shippingZones, type RegionMatcher, type ShippingRate } from '@/db/schema/shipping';
import type { Address } from '@/db/schema/carts';

type Tx = PostgresJsTransaction<Record<string, never>, Record<string, never>>;

export type ShippingResult = {
  cents: number;
  option?: { code: string; label: string };
};

export type CartForShipping = {
  items: Array<{ qty: number; unitPriceCents: number }>;
};

/**
 * Sum (qty × unitPriceCents) over a cart's items in integer cents.
 */
export function sumCartCents(cart: CartForShipping): number {
  let total = 0;
  for (const it of cart.items) {
    total += it.qty * it.unitPriceCents;
  }
  return total;
}

/**
 * Returns true if any of the supplied region matchers includes the address.
 * A matcher with no `regions`/`postalPrefixes` matches the whole country.
 */
export function matchesRegion(matchers: RegionMatcher[], address: Address): boolean {
  const country = address.country?.trim();
  const region = address.region?.trim();
  const postal = address.postal?.trim() ?? '';
  if (!country) return false;
  for (const m of matchers) {
    if (m.country !== country) continue;
    const hasRegions = Array.isArray(m.regions) && m.regions.length > 0;
    const hasPrefixes = Array.isArray(m.postalPrefixes) && m.postalPrefixes.length > 0;
    if (!hasRegions && !hasPrefixes) return true;
    if (hasRegions && region && m.regions!.includes(region)) return true;
    if (hasPrefixes && m.postalPrefixes!.some(p => postal.startsWith(p))) return true;
  }
  return false;
}

/**
 * Pick a single rate from a zone given an optional code and the current
 * cart subtotal. When `code` is given, return that rate iff its min/max
 * window contains the subtotal. Otherwise pick the first eligible.
 */
export function pickRate(
  rates: ShippingRate[],
  rateCode: string | undefined,
  subtotalCents: number,
): ShippingRate | undefined {
  const eligible = (r: ShippingRate): boolean => {
    if (r.minOrderCents !== undefined && subtotalCents < r.minOrderCents) return false;
    if (r.maxOrderCents !== undefined && subtotalCents > r.maxOrderCents) return false;
    return true;
  };
  if (rateCode) {
    const named = rates.find(r => r.code === rateCode);
    if (named && eligible(named)) return named;
    return undefined;
  }
  return rates.find(eligible);
}

export async function computeShipping(
  tx: Tx,
  storeId: string,
  cart: CartForShipping,
  address?: Address,
  rateCode?: string,
): Promise<ShippingResult> {
  if (!address) return { cents: 0 };

  const zones = await tx
    .select()
    .from(shippingZones)
    .where(eq(shippingZones.storeId, storeId));
  if (zones.length === 0) return { cents: 0 };

  const matched =
    zones.find(z => matchesRegion(z.regions, address)) ?? zones.find(z => z.isDefault);
  if (!matched) return { cents: 0 };

  const subtotal = sumCartCents(cart);
  const rate = pickRate(matched.rates, rateCode, subtotal);
  if (!rate) return { cents: 0 };

  const option = { code: rate.code, label: rate.label };

  if (rate.freeOverCents !== undefined && subtotal >= rate.freeOverCents) {
    return { cents: 0, option };
  }
  if (matched.freeOverCents !== null && matched.freeOverCents !== undefined && subtotal >= matched.freeOverCents) {
    return { cents: 0, option };
  }
  return { cents: rate.rateCents, option };
}
