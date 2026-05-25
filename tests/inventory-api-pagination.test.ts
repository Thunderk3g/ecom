/**
 * Inventory cursor pagination — listMovements walks 75 rows at limit=20.
 *
 * Verifies:
 *   - Each page contains at most `limit` items.
 *   - `nextCursor` becomes null on the last page.
 *   - The union of all paged ids has no duplicates and contains exactly the
 *     75 movements seeded for this test.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { resetAndMigrate } from './_setup/db';
import { appClient, migratorClient } from '@/db/client';
import { listMovements } from '@/modules/inventory/movements';
import {
  createLocationFixture,
  createStore,
  createVariant,
} from './_setup/inventory-fixtures';

describe('inventory pagination', () => {
  let storeId: string;
  let variantId: string;
  let locationId: string;
  const TOTAL = 75;
  const LIMIT = 20;

  beforeAll(async () => {
    await resetAndMigrate();
    const store = await createStore('pag-store');
    storeId = store.id;
    const v = await createVariant(storeId);
    variantId = v.variantId;
    const loc = await createLocationFixture(storeId);
    locationId = loc.id;

    // Bulk-insert 75 movements via migratorClient. `inbound` kind keeps
    // stock_levels.on_hand growing positively (the trigger materializes each).
    for (let i = 0; i < TOTAL; i += 1) {
      await migratorClient`
        INSERT INTO stock_movements (store_id, variant_id, location_id, qty, kind, reason)
        VALUES (${storeId}, ${variantId}, ${locationId}, 1, 'inbound', ${'page-' + i})
      `;
    }
  });

  afterAll(async () => {
    await appClient.end();
    await migratorClient.end();
  });

  it('walks all 75 movements at limit=20 with no duplicates', async () => {
    const seenIds = new Set<string>();
    let cursor: string | undefined;
    let pages = 0;
    const maxPages = 10; // safety net

    while (pages < maxPages) {
      const page = await listMovements(storeId, {
        cursor,
        limit: LIMIT,
        variantId,
        locationId,
      });
      pages += 1;

      expect(page.items.length).toBeLessThanOrEqual(LIMIT);
      for (const item of page.items) {
        expect(seenIds.has(item.id)).toBe(false);
        seenIds.add(item.id);
      }

      if (!page.nextCursor) break;
      cursor = page.nextCursor;
    }

    expect(seenIds.size).toBe(TOTAL);
    // 75 / 20 = 4 pages (20, 20, 20, 15).
    expect(pages).toBe(4);
  });
});
