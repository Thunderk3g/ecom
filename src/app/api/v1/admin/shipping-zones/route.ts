/**
 * GET  /api/v1/admin/shipping-zones  — list zones for tenant (cursor-paginated)
 * POST /api/v1/admin/shipping-zones  — create zone
 *
 * SP-4 Stream G (task 19). Queries the `shipping_zones` schema directly via
 * Drizzle inside `withTenant(...)`. Future refactor could extract a service
 * once the cart shipping computation engine starts sharing query logic.
 */

import { NextResponse } from 'next/server';
import { and, asc, eq, gt, or, type SQL } from 'drizzle-orm';
import { z } from 'zod';
import { withTenant } from '@/modules/tenant/with-tenant';
import { shippingZones } from '@/db/schema/shipping';
import { problem } from '@/lib/errors';
import { withIdempotency } from '@/lib/idempotency';
import { decodeCursor, encodeCursor, parseLimit } from '@/lib/cursor';
import {
  ResourceConflictError,
  mapPromotionError,
  readJsonBody,
  runAdminPipeline,
} from '../promotions/_lib';

type ShippingZoneRow = typeof shippingZones.$inferSelect;

function serialize(row: ShippingZoneRow): {
  id: string;
  storeId: string;
  code: string;
  name: string;
  regions: ShippingZoneRow['regions'];
  rates: ShippingZoneRow['rates'];
  freeOverCents: number | null;
  isDefault: boolean;
} {
  return {
    id: row.id,
    storeId: row.storeId,
    code: row.code,
    name: row.name,
    regions: row.regions,
    rates: row.rates,
    freeOverCents: row.freeOverCents,
    isDefault: row.isDefault,
  };
}

const regionMatcherSchema = z
  .object({
    country: z.string().min(2).max(2),
    regions: z.array(z.string().min(1)).optional(),
    postalPrefixes: z.array(z.string().min(1)).optional(),
  })
  .strict();

const shippingRateSchema = z
  .object({
    code: z.string().min(1),
    label: z.string().min(1),
    rateCents: z.number().int().nonnegative(),
    minOrderCents: z.number().int().nonnegative().optional(),
    maxOrderCents: z.number().int().nonnegative().optional(),
    freeOverCents: z.number().int().nonnegative().optional(),
  })
  .strict();

const createBody = z.object({
  code: z.string().min(1).max(64),
  name: z.string().min(1),
  regions: z.array(regionMatcherSchema),
  rates: z.array(shippingRateSchema),
  freeOverCents: z.number().int().nonnegative().nullish(),
  isDefault: z.boolean().optional(),
});

export async function GET(req: Request): Promise<NextResponse> {
  const pipeline = await runAdminPipeline(req, {
    requireMutation: false,
    permission: 'shipping:read',
  });
  if (!pipeline.ok) return pipeline.response;

  const url = new URL(req.url);
  const cursorRaw = url.searchParams.get('after') ?? undefined;
  const limit = parseLimit(url.searchParams.get('limit'));
  const codeFilter = url.searchParams.get('code');

  try {
    const result = await withTenant(pipeline.storeId, async tx => {
      const filters: SQL[] = [];
      if (codeFilter) filters.push(eq(shippingZones.code, codeFilter));
      if (cursorRaw) {
        const decoded = decodeCursor(cursorRaw);
        if (decoded) {
          // Order is code asc, id asc (no createdAt on shipping_zones).
          filters.push(
            or(
              gt(shippingZones.code, decoded.k),
              and(eq(shippingZones.code, decoded.k), gt(shippingZones.id, decoded.id)),
            ) as SQL,
          );
        }
      }

      const whereClause = filters.length > 0 ? and(...filters) : undefined;

      const rows = await tx
        .select()
        .from(shippingZones)
        .where(whereClause)
        .orderBy(asc(shippingZones.code), asc(shippingZones.id))
        .limit(limit + 1);

      const hasMore = rows.length > limit;
      const sliced = hasMore ? rows.slice(0, limit) : rows;
      const items = sliced.map(serialize);
      const last = sliced[sliced.length - 1];
      const nextCursor =
        hasMore && last ? encodeCursor({ k: last.code, id: last.id }) : null;
      return { items, nextCursor };
    });

    return NextResponse.json({ data: result.items, page: { nextCursor: result.nextCursor } });
  } catch (err) {
    return mapPromotionError(err);
  }
}

export async function POST(req: Request): Promise<NextResponse> {
  const pipeline = await runAdminPipeline(req, {
    requireMutation: true,
    permission: 'shipping:write',
  });
  if (!pipeline.ok) return pipeline.response;

  const parsed = await readJsonBody(req);
  if (!parsed.ok) return parsed.response;
  const validated = createBody.safeParse(parsed.data);
  if (!validated.success) {
    return problem(
      422,
      'invalid-body',
      'Invalid shipping zone body',
      validated.error.issues.map(i => ({ path: i.path.map(p => String(p)), message: i.message })),
    );
  }

  const body = validated.data;

  try {
    const created = await withIdempotency(
      `admin:shipping-zones:create:${pipeline.storeId}`,
      pipeline.idempotencyKey!,
      async () =>
        withTenant(pipeline.storeId, async tx => {
          const [clash] = await tx
            .select({ id: shippingZones.id })
            .from(shippingZones)
            .where(eq(shippingZones.code, body.code))
            .limit(1);
          if (clash) {
            throw new ResourceConflictError('shipping-zone', 'code', body.code);
          }

          const [row] = await tx
            .insert(shippingZones)
            .values({
              storeId: pipeline.storeId,
              code: body.code,
              name: body.name,
              regions: body.regions,
              rates: body.rates,
              freeOverCents: body.freeOverCents ?? null,
              ...(body.isDefault !== undefined ? { isDefault: body.isDefault } : {}),
            })
            .returning();
          if (!row) throw new Error('shipping_zones insert returned no row');
          return serialize(row);
        }),
    );
    return NextResponse.json({ data: created }, { status: 201 });
  } catch (err) {
    return mapPromotionError(err);
  }
}
