/**
 * Stock thresholds module — read/write reorder points for (variant, location).
 *
 * Thresholds drive the low-stock alert NOTIFY in the 0010 trigger and the
 * `low: boolean` storefront signal. The composite primary key
 * (variant_id, location_id) means there is at most one threshold per cell;
 * `setThreshold` upserts.
 */

import { and, asc, eq } from 'drizzle-orm';
import { withTenant } from '@/modules/tenant/with-tenant';
import { stockThresholds } from '@/db/schema/inventory';
import { ThresholdNotFoundError } from './errors';

export interface ThresholdRow {
  variantId: string;
  locationId: string;
  storeId: string;
  reorderPoint: number;
  reorderQty: number;
  updatedAt: Date;
}

export interface SetThresholdInput {
  variantId: string;
  locationId: string;
  reorderPoint: number;
  reorderQty: number;
}

export interface ListThresholdsOptions {
  variantId?: string;
  locationId?: string;
}

function toRow(r: {
  variantId: string;
  locationId: string;
  storeId: string;
  reorderPoint: number;
  reorderQty: number;
  updatedAt: Date;
}): ThresholdRow {
  return {
    variantId: r.variantId,
    locationId: r.locationId,
    storeId: r.storeId,
    reorderPoint: r.reorderPoint,
    reorderQty: r.reorderQty,
    updatedAt: r.updatedAt,
  };
}

/**
 * List thresholds for the current tenant. Optional filters by variant or
 * location narrow the result set. Threshold counts scale with catalog size
 * but are bounded by `variants × locations` and typically small enough that
 * non-paginated listing is acceptable; if this becomes a hotspot a cursor
 * can be added without breaking callers.
 */
export async function listThresholds(
  storeId: string,
  opts: ListThresholdsOptions = {},
): Promise<ThresholdRow[]> {
  return withTenant(storeId, async tx => {
    const filters = [];
    if (opts.variantId) filters.push(eq(stockThresholds.variantId, opts.variantId));
    if (opts.locationId) filters.push(eq(stockThresholds.locationId, opts.locationId));

    const whereClause = filters.length > 0 ? and(...filters) : undefined;

    const rows = await tx
      .select()
      .from(stockThresholds)
      .where(whereClause)
      .orderBy(asc(stockThresholds.variantId), asc(stockThresholds.locationId));
    return rows.map(toRow);
  });
}

export async function getThreshold(
  storeId: string,
  variantId: string,
  locationId: string,
): Promise<ThresholdRow> {
  return withTenant(storeId, async tx => {
    const [row] = await tx
      .select()
      .from(stockThresholds)
      .where(
        and(
          eq(stockThresholds.variantId, variantId),
          eq(stockThresholds.locationId, locationId),
        ),
      );
    if (!row) throw new ThresholdNotFoundError(variantId, locationId);
    return toRow(row);
  });
}

/**
 * Upsert a threshold. Inserts on first call, updates `reorder_point`,
 * `reorder_qty`, and `updated_at` on subsequent calls for the same
 * (variant, location).
 */
export async function setThreshold(
  storeId: string,
  input: SetThresholdInput,
): Promise<ThresholdRow> {
  return withTenant(storeId, async tx => {
    const [row] = await tx
      .insert(stockThresholds)
      .values({
        storeId,
        variantId: input.variantId,
        locationId: input.locationId,
        reorderPoint: input.reorderPoint,
        reorderQty: input.reorderQty,
      })
      .onConflictDoUpdate({
        target: [stockThresholds.variantId, stockThresholds.locationId],
        set: {
          reorderPoint: input.reorderPoint,
          reorderQty: input.reorderQty,
          updatedAt: new Date(),
        },
      })
      .returning();
    if (!row) throw new Error('stock_thresholds upsert returned no row');
    return toRow(row);
  });
}

export async function deleteThreshold(
  storeId: string,
  variantId: string,
  locationId: string,
): Promise<void> {
  return withTenant(storeId, async tx => {
    const deleted = await tx
      .delete(stockThresholds)
      .where(
        and(
          eq(stockThresholds.variantId, variantId),
          eq(stockThresholds.locationId, locationId),
        ),
      )
      .returning({ variantId: stockThresholds.variantId });
    if (deleted.length === 0) throw new ThresholdNotFoundError(variantId, locationId);
  });
}
