/**
 * Locations module — CRUD for `locations`.
 *
 * Locations are tenant-scoped warehouses / stores / transit hubs. Every
 * stock movement and reservation pins to one. Deletion is blocked when any
 * `stock_levels` rows still reference the location (LocationInUseError) —
 * callers must drain stock (transfer / adjust to zero) first.
 *
 * The `(store_id, code)` unique constraint enforces per-tenant codes; we surface
 * a Postgres unique-violation as a plain Error so the HTTP layer can map it to
 * a 409. (Stream E owns the routing layer; this module just throws.)
 */

import { asc, count, eq } from 'drizzle-orm';
import { withTenant } from '@/modules/tenant/with-tenant';
import { locations, stockLevels } from '@/db/schema/inventory';
import { LocationInUseError, LocationNotFoundError } from './errors';

export type LocationType = 'warehouse' | 'store' | 'transit';

export interface LocationRow {
  id: string;
  storeId: string;
  code: string;
  name: string;
  type: LocationType;
  createdAt: Date;
}

export interface CreateLocationInput {
  code: string;
  name: string;
  type: LocationType;
}

export interface UpdateLocationInput {
  code?: string;
  name?: string;
  type?: LocationType;
}

function toRow(r: {
  id: string;
  storeId: string;
  code: string;
  name: string;
  type: LocationType;
  createdAt: Date;
}): LocationRow {
  return {
    id: r.id,
    storeId: r.storeId,
    code: r.code,
    name: r.name,
    type: r.type,
    createdAt: r.createdAt,
  };
}

/**
 * List all locations for the current tenant, ordered by code asc.
 * Location counts are bounded (handful per store), so no pagination here.
 */
export async function listLocations(storeId: string): Promise<LocationRow[]> {
  return withTenant(storeId, async tx => {
    const rows = await tx
      .select()
      .from(locations)
      .orderBy(asc(locations.code));
    return rows.map(toRow);
  });
}

export async function getLocation(
  storeId: string,
  locationId: string,
): Promise<LocationRow> {
  return withTenant(storeId, async tx => {
    const [row] = await tx
      .select()
      .from(locations)
      .where(eq(locations.id, locationId));
    if (!row) throw new LocationNotFoundError(locationId);
    return toRow(row);
  });
}

export async function createLocation(
  storeId: string,
  input: CreateLocationInput,
): Promise<LocationRow> {
  return withTenant(storeId, async tx => {
    const [row] = await tx
      .insert(locations)
      .values({
        storeId,
        code: input.code,
        name: input.name,
        type: input.type,
      })
      .returning();
    if (!row) throw new Error('locations insert returned no row');
    return toRow(row);
  });
}

export async function updateLocation(
  storeId: string,
  locationId: string,
  input: UpdateLocationInput,
): Promise<LocationRow> {
  return withTenant(storeId, async tx => {
    const patch: { code?: string; name?: string; type?: LocationType } = {};
    if (input.code !== undefined) patch.code = input.code;
    if (input.name !== undefined) patch.name = input.name;
    if (input.type !== undefined) patch.type = input.type;

    if (Object.keys(patch).length === 0) {
      const [row] = await tx
        .select()
        .from(locations)
        .where(eq(locations.id, locationId));
      if (!row) throw new LocationNotFoundError(locationId);
      return toRow(row);
    }

    const [row] = await tx
      .update(locations)
      .set(patch)
      .where(eq(locations.id, locationId))
      .returning();
    if (!row) throw new LocationNotFoundError(locationId);
    return toRow(row);
  });
}

/**
 * Delete a location. Refuses with `LocationInUseError` when any `stock_levels`
 * rows reference it (regardless of on_hand / reserved values — even a zeroed
 * row pins the location for audit). Drain stock first via transfers/adjustments,
 * then delete.
 */
export async function deleteLocation(
  storeId: string,
  locationId: string,
): Promise<void> {
  return withTenant(storeId, async tx => {
    const [existing] = await tx
      .select({ id: locations.id })
      .from(locations)
      .where(eq(locations.id, locationId));
    if (!existing) throw new LocationNotFoundError(locationId);

    const [usage] = await tx
      .select({ n: count() })
      .from(stockLevels)
      .where(eq(stockLevels.locationId, locationId));

    const levelCount = usage?.n ?? 0;
    if (levelCount > 0) {
      throw new LocationInUseError(locationId, Number(levelCount));
    }

    await tx.delete(locations).where(eq(locations.id, locationId));
  });
}
