/**
 * Inventory availability — checkAvailability and lazy-expiry semantics.
 *
 * Scenarios:
 *   - on_hand=10, reserved=3 → available=7, canFulfill(7)=true.
 *   - With one expired active reservation (qty 2), available is still reported
 *     as 7 (lazy expiry adds the expired reservation back to live availability).
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { resetAndMigrate } from './_setup/db';
import { appClient, migratorClient } from '@/db/client';
import { checkAvailability } from '@/modules/inventory/availability';
import {
  createLocationFixture,
  createStore,
  createVariant,
  seedOnHand,
  seedReserved,
} from './_setup/inventory-fixtures';

describe('inventory availability', () => {
  let storeId: string;
  let variantId: string;
  let locationId: string;

  beforeAll(async () => {
    await resetAndMigrate();
    const store = await createStore('avail-store');
    storeId = store.id;
    const v = await createVariant(storeId);
    variantId = v.variantId;
    const loc = await createLocationFixture(storeId);
    locationId = loc.id;

    // on_hand = 10, reserved = 3 (both via ledger movements).
    await seedOnHand(storeId, variantId, locationId, 10);
    await seedReserved(storeId, variantId, locationId, 3);
  });

  afterAll(async () => {
    await appClient.end();
    await migratorClient.end();
  });

  it('returns available=7 and canFulfill=true for qty=7', async () => {
    const result = await checkAvailability(storeId, variantId, locationId, 7);
    expect(result.available).toBe(7);
    expect(result.canFulfill).toBe(true);
  });

  it('returns canFulfill=false for qty=8', async () => {
    const result = await checkAvailability(storeId, variantId, locationId, 8);
    expect(result.available).toBe(7);
    expect(result.canFulfill).toBe(false);
  });

  it('lazy expiry: an expired active reservation is added back to available', async () => {
    // Insert a reservation row directly (not a `reservation` movement — we want
    // reserved in stock_levels to stay at 3 so that the lazy-expiry add-back
    // is what makes available come out to 7 again).
    //
    // The reservation expired one minute ago; checkAvailability subtracts the
    // expired reservation qty from `reserved` (i.e., adds it back to available).
    //
    // To prove the lazy-expiry path: first bump reserved by qty=2 via a
    // reservation movement (so stock_levels.reserved becomes 5; raw available = 5),
    // then create the expired reservation row of qty=2. After lazy expiry the
    // module should report 5 + 2 = 7 again.
    await seedReserved(storeId, variantId, locationId, 2);

    const expiredAt = new Date(Date.now() - 60_000).toISOString();
    await migratorClient`
      INSERT INTO stock_reservations (store_id, variant_id, location_id, qty, expires_at, status)
      VALUES (${storeId}, ${variantId}, ${locationId}, 2, ${expiredAt}::timestamptz, 'active')
    `;

    const result = await checkAvailability(storeId, variantId, locationId, 7);
    expect(result.available).toBe(7);
    expect(result.canFulfill).toBe(true);
  });
});
