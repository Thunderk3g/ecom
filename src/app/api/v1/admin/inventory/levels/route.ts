/**
 * GET /api/v1/admin/inventory/levels
 *
 * Paginated admin view of the materialized `stock_levels` snapshot, optionally
 * filtered by variant, location, or `lowOnly=true` (joins `stock_thresholds`
 * and returns only cells whose `(on_hand - reserved) <= reorder_point`).
 *
 * The list endpoint reads the materialized snapshot directly — it intentionally
 * does NOT apply lazy expiry (which is a storefront UX concern). Admins see the
 * raw `on_hand`, `reserved`, and `available` values as persisted by the
 * trigger; the sweep is what makes the snapshot honest.
 *
 * Cursor pagination: keyset on `(variant_id, location_id)` ascending so the
 * order is deterministic and stable for big stores. The cursor uses the shared
 * `(k, id)` payload with `k = variantId`, `id = locationId`.
 */

import { NextResponse } from 'next/server';
import { and, asc, eq, gt, lte, or, sql, type SQL } from 'drizzle-orm';
import { withTenant } from '@/modules/tenant/with-tenant';
import { stockLevels, stockThresholds } from '@/db/schema/inventory';
import { decodeCursor, encodeCursor, parseLimit } from '@/lib/cursor';
import { mapInventoryError, runAdminPipeline } from '../_lib';

interface StockLevelView {
  variantId: string;
  locationId: string;
  storeId: string;
  onHand: number;
  reserved: number;
  available: number;
  updatedAt: Date;
}

export async function GET(req: Request): Promise<NextResponse> {
  const pipeline = await runAdminPipeline(req, {
    requireMutation: false,
    permission: 'inventory:read',
  });
  if (!pipeline.ok) return pipeline.response;

  const url = new URL(req.url);
  const variantIdFilter = url.searchParams.get('variantId') ?? undefined;
  const locationIdFilter = url.searchParams.get('locationId') ?? undefined;
  const lowOnly = url.searchParams.get('lowOnly') === 'true';
  const cursor = url.searchParams.get('after') ?? undefined;
  const limit = parseLimit(url.searchParams.get('limit') ?? undefined);

  try {
    const result = await withTenant<{ items: StockLevelView[]; nextCursor: string | null }>(
      pipeline.storeId,
      async tx => {
        const filters: SQL[] = [];
        if (variantIdFilter) filters.push(eq(stockLevels.variantId, variantIdFilter));
        if (locationIdFilter) filters.push(eq(stockLevels.locationId, locationIdFilter));

        if (cursor) {
          const decoded = decodeCursor(cursor);
          if (decoded) {
            // (variant_id > cursor.k) OR (variant_id = cursor.k AND location_id > cursor.id)
            filters.push(
              or(
                gt(stockLevels.variantId, decoded.k),
                and(eq(stockLevels.variantId, decoded.k), gt(stockLevels.locationId, decoded.id)),
              ) as SQL,
            );
          }
        }

        const availableExpr = sql<number>`(${stockLevels.onHand} - ${stockLevels.reserved})`;

        if (lowOnly) {
          const rows = await tx
            .select({
              variantId: stockLevels.variantId,
              locationId: stockLevels.locationId,
              storeId: stockLevels.storeId,
              onHand: stockLevels.onHand,
              reserved: stockLevels.reserved,
              available: sql<number>`(${stockLevels.onHand} - ${stockLevels.reserved})::int`,
              updatedAt: stockLevels.updatedAt,
            })
            .from(stockLevels)
            .innerJoin(
              stockThresholds,
              and(
                eq(stockThresholds.variantId, stockLevels.variantId),
                eq(stockThresholds.locationId, stockLevels.locationId),
              ),
            )
            .where(
              and(
                lte(availableExpr, stockThresholds.reorderPoint),
                ...(filters.length > 0 ? [and(...filters) as SQL] : []),
              ),
            )
            .orderBy(asc(stockLevels.variantId), asc(stockLevels.locationId))
            .limit(limit + 1);

          const hasMore = rows.length > limit;
          const sliced = hasMore ? rows.slice(0, limit) : rows;
          const last = sliced[sliced.length - 1];
          const nextCursor =
            hasMore && last ? encodeCursor({ k: last.variantId, id: last.locationId }) : null;
          return { items: sliced, nextCursor };
        }

        const whereClause = filters.length > 0 ? and(...filters) : undefined;
        const rows = await tx
          .select({
            variantId: stockLevels.variantId,
            locationId: stockLevels.locationId,
            storeId: stockLevels.storeId,
            onHand: stockLevels.onHand,
            reserved: stockLevels.reserved,
            available: sql<number>`(${stockLevels.onHand} - ${stockLevels.reserved})::int`,
            updatedAt: stockLevels.updatedAt,
          })
          .from(stockLevels)
          .where(whereClause)
          .orderBy(asc(stockLevels.variantId), asc(stockLevels.locationId))
          .limit(limit + 1);

        const hasMore = rows.length > limit;
        const sliced = hasMore ? rows.slice(0, limit) : rows;
        const last = sliced[sliced.length - 1];
        const nextCursor =
          hasMore && last ? encodeCursor({ k: last.variantId, id: last.locationId }) : null;
        return { items: sliced, nextCursor };
      },
    );

    return NextResponse.json({
      data: result.items,
      page: { nextCursor: result.nextCursor },
    });
  } catch (err) {
    return mapInventoryError(err);
  }
}
