/**
 * Inventory locations module — CRUD + deletion guard.
 *
 * Uses `migratorClient` (BYPASSRLS) only for `resetAndMigrate` and the store
 * fixture; all assertions go through module services running under
 * `withTenant` (NOBYPASSRLS app_user).
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { resetAndMigrate } from './_setup/db';
import { appClient, migratorClient } from '@/db/client';
import {
  createLocation,
  deleteLocation,
  getLocation,
  listLocations,
  updateLocation,
} from '@/modules/inventory/locations';
import { LocationInUseError, LocationNotFoundError } from '@/modules/inventory/errors';
import {
  createStore,
  createVariant,
  seedOnHand,
} from './_setup/inventory-fixtures';

describe('inventory locations', () => {
  let storeId: string;
  let variantId: string;

  beforeAll(async () => {
    await resetAndMigrate();
    const store = await createStore('locs-store');
    storeId = store.id;
    const v = await createVariant(storeId);
    variantId = v.variantId;
  });

  afterAll(async () => {
    await appClient.end();
    await migratorClient.end();
  });

  it('createLocation persists and listLocations returns it', async () => {
    const created = await createLocation(storeId, {
      code: 'wh-1',
      name: 'Warehouse 1',
      type: 'warehouse',
    });
    expect(created.code).toBe('wh-1');
    expect(created.storeId).toBe(storeId);

    const list = await listLocations(storeId);
    expect(list.map(l => l.code)).toContain('wh-1');
  });

  it('getLocation returns the row by id', async () => {
    const created = await createLocation(storeId, {
      code: 'wh-2',
      name: 'Warehouse 2',
      type: 'warehouse',
    });
    const fetched = await getLocation(storeId, created.id);
    expect(fetched.id).toBe(created.id);
    expect(fetched.name).toBe('Warehouse 2');
  });

  it('updateLocation patches mutable fields', async () => {
    const created = await createLocation(storeId, {
      code: 'wh-3',
      name: 'Warehouse 3',
      type: 'warehouse',
    });
    const patched = await updateLocation(storeId, created.id, { name: 'Renamed' });
    expect(patched.name).toBe('Renamed');
    expect(patched.code).toBe('wh-3');
  });

  it('getLocation throws LocationNotFoundError for unknown id', async () => {
    await expect(getLocation(storeId, crypto.randomUUID())).rejects.toBeInstanceOf(
      LocationNotFoundError,
    );
  });

  it('deleteLocation succeeds when no stock_levels rows reference it', async () => {
    const created = await createLocation(storeId, {
      code: 'wh-empty',
      name: 'Empty WH',
      type: 'warehouse',
    });
    await expect(deleteLocation(storeId, created.id)).resolves.toBeUndefined();
    await expect(getLocation(storeId, created.id)).rejects.toBeInstanceOf(
      LocationNotFoundError,
    );
  });

  it('deleteLocation refuses with LocationInUseError when stock_levels reference it', async () => {
    const loc = await createLocation(storeId, {
      code: 'wh-in-use',
      name: 'Used WH',
      type: 'warehouse',
    });
    // Seed a movement → trigger materializes stock_levels row → location is in use.
    await seedOnHand(storeId, variantId, loc.id, 5);

    await expect(deleteLocation(storeId, loc.id)).rejects.toBeInstanceOf(LocationInUseError);
  });
});
