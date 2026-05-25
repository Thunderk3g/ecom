/**
 * GET /api/v1/admin/inventory/reservations
 *
 * Cursor-paginated listing of reservations. Defaults to `status=active` to
 * surface what's holding stock right now; pass `status=committed|released|
 * expired|all` to override. Newest-first by `created_at` with `id`
 * tiebreaker, matching the cursor shape used elsewhere.
 *
 * No module helper exists for this view (reserve/release/commit are the
 * write surface); admins need read-only visibility so the route queries the
 * table directly via `withTenant`.
 */

import { NextResponse } from 'next/server';
import { and, desc, eq, lt, or, type SQL } from 'drizzle-orm';
import { withTenant } from '@/modules/tenant/with-tenant';
import { stockReservations } from '@/db/schema/inventory';
import { decodeCursor, encodeCursor, parseLimit } from '@/lib/cursor';
import { mapInventoryError, runAdminPipeline } from '../_lib';

const RESERVATION_STATUSES = ['active', 'committed', 'released', 'expired'] as const;
type ReservationStatus = (typeof RESERVATION_STATUSES)[number];

interface ReservationView {
  id: string;
  storeId: string;
  variantId: string;
  locationId: string;
  qty: number;
  cartId: string | null;
  orderId: string | null;
  expiresAt: Date;
  status: ReservationStatus;
  createdAt: Date;
}

export async function GET(req: Request): Promise<NextResponse> {
  const pipeline = await runAdminPipeline(req, {
    requireMutation: false,
    permission: 'inventory:read',
  });
  if (!pipeline.ok) return pipeline.response;

  const url = new URL(req.url);
  const cursor = url.searchParams.get('after') ?? undefined;
  const limit = parseLimit(url.searchParams.get('limit') ?? undefined);
  const variantId = url.searchParams.get('variantId') ?? undefined;
  const locationId = url.searchParams.get('locationId') ?? undefined;
  const cartId = url.searchParams.get('cartId') ?? undefined;
  const statusRaw = url.searchParams.get('status') ?? 'active';
  const statusFilter: ReservationStatus | 'all' =
    statusRaw === 'all'
      ? 'all'
      : (RESERVATION_STATUSES as readonly string[]).includes(statusRaw)
        ? (statusRaw as ReservationStatus)
        : 'active';

  try {
    const result = await withTenant<{ items: ReservationView[]; nextCursor: string | null }>(
      pipeline.storeId,
      async tx => {
        const filters: SQL[] = [];
        if (statusFilter !== 'all') {
          filters.push(eq(stockReservations.status, statusFilter));
        }
        if (variantId) filters.push(eq(stockReservations.variantId, variantId));
        if (locationId) filters.push(eq(stockReservations.locationId, locationId));
        if (cartId) filters.push(eq(stockReservations.cartId, cartId));

        if (cursor) {
          const decoded = decodeCursor(cursor);
          if (decoded) {
            const cutoff = new Date(decoded.k);
            filters.push(
              or(
                lt(stockReservations.createdAt, cutoff),
                and(
                  eq(stockReservations.createdAt, cutoff),
                  lt(stockReservations.id, decoded.id),
                ),
              ) as SQL,
            );
          }
        }

        const whereClause = filters.length > 0 ? and(...filters) : undefined;
        const rows = await tx
          .select()
          .from(stockReservations)
          .where(whereClause)
          .orderBy(desc(stockReservations.createdAt), desc(stockReservations.id))
          .limit(limit + 1);

        const hasMore = rows.length > limit;
        const sliced = hasMore ? rows.slice(0, limit) : rows;
        const items: ReservationView[] = sliced.map(r => ({
          id: r.id,
          storeId: r.storeId,
          variantId: r.variantId,
          locationId: r.locationId,
          qty: r.qty,
          cartId: r.cartId,
          orderId: r.orderId,
          expiresAt: r.expiresAt,
          status: r.status as ReservationStatus,
          createdAt: r.createdAt,
        }));

        const last = items[items.length - 1];
        const nextCursor =
          hasMore && last
            ? encodeCursor({ k: last.createdAt.toISOString(), id: last.id })
            : null;

        return { items, nextCursor };
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
