/**
 * GET    /api/v1/admin/shipping-zones/[id]
 * PATCH  /api/v1/admin/shipping-zones/[id]
 * DELETE /api/v1/admin/shipping-zones/[id]
 *
 * SP-4 Stream G (task 19). Queries the `shipping_zones` schema directly.
 */

import { NextResponse } from 'next/server';
import { and, eq, ne } from 'drizzle-orm';
import { z } from 'zod';
import { withTenant } from '@/modules/tenant/with-tenant';
import { shippingZones } from '@/db/schema/shipping';
import { problem } from '@/lib/errors';
import { withIdempotency } from '@/lib/idempotency';
import {
  ResourceConflictError,
  ResourceNotFoundError,
  mapPromotionError,
  readJsonBody,
  runAdminPipeline,
} from '../../promotions/_lib';

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

const patchBody = z.object({
  code: z.string().min(1).max(64).optional(),
  name: z.string().min(1).optional(),
  regions: z.array(regionMatcherSchema).optional(),
  rates: z.array(shippingRateSchema).optional(),
  freeOverCents: z.number().int().nonnegative().nullable().optional(),
  isDefault: z.boolean().optional(),
});

type RouteCtx = { params: Promise<{ id: string }> };

export async function GET(req: Request, ctx: RouteCtx): Promise<NextResponse> {
  const pipeline = await runAdminPipeline(req, {
    requireMutation: false,
    permission: 'shipping:read',
  });
  if (!pipeline.ok) return pipeline.response;

  const { id } = await ctx.params;
  try {
    const row = await withTenant(pipeline.storeId, async tx => {
      const [r] = await tx
        .select()
        .from(shippingZones)
        .where(eq(shippingZones.id, id))
        .limit(1);
      if (!r) throw new ResourceNotFoundError('shipping-zone', id);
      return r;
    });
    return NextResponse.json({ data: serialize(row) });
  } catch (err) {
    return mapPromotionError(err);
  }
}

export async function PATCH(req: Request, ctx: RouteCtx): Promise<NextResponse> {
  const pipeline = await runAdminPipeline(req, {
    requireMutation: true,
    permission: 'shipping:write',
  });
  if (!pipeline.ok) return pipeline.response;

  const { id } = await ctx.params;
  const parsed = await readJsonBody(req);
  if (!parsed.ok) return parsed.response;
  const validated = patchBody.safeParse(parsed.data);
  if (!validated.success) {
    return problem(
      422,
      'invalid-body',
      'Invalid shipping zone patch',
      validated.error.issues.map(i => ({ path: i.path.map(p => String(p)), message: i.message })),
    );
  }

  const body = validated.data;

  try {
    const updated = await withIdempotency(
      `admin:shipping-zones:patch:${pipeline.storeId}:${id}`,
      pipeline.idempotencyKey!,
      async () =>
        withTenant(pipeline.storeId, async tx => {
          const [existing] = await tx
            .select()
            .from(shippingZones)
            .where(eq(shippingZones.id, id))
            .limit(1);
          if (!existing) throw new ResourceNotFoundError('shipping-zone', id);

          if (body.code !== undefined && body.code !== existing.code) {
            const [clash] = await tx
              .select({ id: shippingZones.id })
              .from(shippingZones)
              .where(and(eq(shippingZones.code, body.code), ne(shippingZones.id, id)))
              .limit(1);
            if (clash) {
              throw new ResourceConflictError('shipping-zone', 'code', body.code);
            }
          }

          const patch: Partial<typeof shippingZones.$inferInsert> = {};
          if (body.code !== undefined) patch.code = body.code;
          if (body.name !== undefined) patch.name = body.name;
          if (body.regions !== undefined) patch.regions = body.regions;
          if (body.rates !== undefined) patch.rates = body.rates;
          if (body.freeOverCents !== undefined) patch.freeOverCents = body.freeOverCents;
          if (body.isDefault !== undefined) patch.isDefault = body.isDefault;

          if (Object.keys(patch).length === 0) {
            return serialize(existing);
          }

          const [row] = await tx
            .update(shippingZones)
            .set(patch)
            .where(eq(shippingZones.id, id))
            .returning();
          if (!row) throw new ResourceNotFoundError('shipping-zone', id);
          return serialize(row);
        }),
    );
    return NextResponse.json({ data: updated });
  } catch (err) {
    return mapPromotionError(err);
  }
}

export async function DELETE(req: Request, ctx: RouteCtx): Promise<NextResponse> {
  const pipeline = await runAdminPipeline(req, {
    requireMutation: true,
    permission: 'shipping:write',
  });
  if (!pipeline.ok) return pipeline.response;

  const { id } = await ctx.params;
  try {
    await withIdempotency(
      `admin:shipping-zones:delete:${pipeline.storeId}:${id}`,
      pipeline.idempotencyKey!,
      async () =>
        withTenant(pipeline.storeId, async tx => {
          const [existing] = await tx
            .select({ id: shippingZones.id })
            .from(shippingZones)
            .where(eq(shippingZones.id, id))
            .limit(1);
          if (!existing) throw new ResourceNotFoundError('shipping-zone', id);
          await tx.delete(shippingZones).where(eq(shippingZones.id, id));
          return { deleted: true } as const;
        }),
    );
    return new NextResponse(null, { status: 204 });
  } catch (err) {
    return mapPromotionError(err);
  }
}
