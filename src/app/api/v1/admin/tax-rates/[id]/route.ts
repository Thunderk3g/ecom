/**
 * GET    /api/v1/admin/tax-rates/[id]
 * PATCH  /api/v1/admin/tax-rates/[id]
 * DELETE /api/v1/admin/tax-rates/[id]
 *
 * SP-4 Stream G (task 19). Queries the `tax_rates` schema directly.
 */

import { NextResponse } from 'next/server';
import { and, eq, ne } from 'drizzle-orm';
import { z } from 'zod';
import { withTenant } from '@/modules/tenant/with-tenant';
import { taxRates } from '@/db/schema/tax';
import { problem } from '@/lib/errors';
import { withIdempotency } from '@/lib/idempotency';
import {
  ResourceConflictError,
  ResourceNotFoundError,
  mapPromotionError,
  readJsonBody,
  runAdminPipeline,
} from '../../promotions/_lib';

type TaxRateRow = typeof taxRates.$inferSelect;

function serialize(row: TaxRateRow): {
  id: string;
  storeId: string;
  regionCode: string;
  rate: string;
  label: string;
  inclusive: boolean;
  taxClass: string;
} {
  return {
    id: row.id,
    storeId: row.storeId,
    regionCode: row.regionCode,
    rate: row.rate,
    label: row.label,
    inclusive: row.inclusive,
    taxClass: row.taxClass,
  };
}

const rateInput = z.union([
  z
    .string()
    .regex(/^\d+(\.\d{1,4})?$/, 'must be a decimal with up to 4 fractional digits'),
  z.number().nonnegative(),
]);

const patchBody = z.object({
  regionCode: z.string().min(1).max(16).optional(),
  rate: rateInput.optional(),
  label: z.string().min(1).optional(),
  inclusive: z.boolean().optional(),
  taxClass: z.string().min(1).optional(),
});

function rateToString(v: string | number): string {
  return typeof v === 'string' ? v : v.toString();
}

type RouteCtx = { params: Promise<{ id: string }> };

export async function GET(req: Request, ctx: RouteCtx): Promise<NextResponse> {
  const pipeline = await runAdminPipeline(req, {
    requireMutation: false,
    permission: 'tax:read',
  });
  if (!pipeline.ok) return pipeline.response;

  const { id } = await ctx.params;
  try {
    const row = await withTenant(pipeline.storeId, async tx => {
      const [r] = await tx.select().from(taxRates).where(eq(taxRates.id, id)).limit(1);
      if (!r) throw new ResourceNotFoundError('tax-rate', id);
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
    permission: 'tax:write',
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
      'Invalid tax rate patch',
      validated.error.issues.map(i => ({ path: i.path.map(p => String(p)), message: i.message })),
    );
  }

  const body = validated.data;

  try {
    const updated = await withIdempotency(
      `admin:tax-rates:patch:${pipeline.storeId}:${id}`,
      pipeline.idempotencyKey!,
      async () =>
        withTenant(pipeline.storeId, async tx => {
          const [existing] = await tx
            .select()
            .from(taxRates)
            .where(eq(taxRates.id, id))
            .limit(1);
          if (!existing) throw new ResourceNotFoundError('tax-rate', id);

          const nextRegion = body.regionCode ?? existing.regionCode;
          const nextClass = body.taxClass ?? existing.taxClass;
          const regionOrClassChanged =
            (body.regionCode !== undefined && body.regionCode !== existing.regionCode) ||
            (body.taxClass !== undefined && body.taxClass !== existing.taxClass);

          if (regionOrClassChanged) {
            const [clash] = await tx
              .select({ id: taxRates.id })
              .from(taxRates)
              .where(
                and(
                  eq(taxRates.regionCode, nextRegion),
                  eq(taxRates.taxClass, nextClass),
                  ne(taxRates.id, id),
                ),
              )
              .limit(1);
            if (clash) {
              throw new ResourceConflictError(
                'tax-rate',
                'region-class',
                `${nextRegion}/${nextClass}`,
              );
            }
          }

          const patch: Partial<typeof taxRates.$inferInsert> = {};
          if (body.regionCode !== undefined) patch.regionCode = body.regionCode;
          if (body.rate !== undefined) patch.rate = rateToString(body.rate);
          if (body.label !== undefined) patch.label = body.label;
          if (body.inclusive !== undefined) patch.inclusive = body.inclusive;
          if (body.taxClass !== undefined) patch.taxClass = body.taxClass;

          if (Object.keys(patch).length === 0) {
            return serialize(existing);
          }

          const [row] = await tx
            .update(taxRates)
            .set(patch)
            .where(eq(taxRates.id, id))
            .returning();
          if (!row) throw new ResourceNotFoundError('tax-rate', id);
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
    permission: 'tax:write',
  });
  if (!pipeline.ok) return pipeline.response;

  const { id } = await ctx.params;
  try {
    await withIdempotency(
      `admin:tax-rates:delete:${pipeline.storeId}:${id}`,
      pipeline.idempotencyKey!,
      async () =>
        withTenant(pipeline.storeId, async tx => {
          const [existing] = await tx
            .select({ id: taxRates.id })
            .from(taxRates)
            .where(eq(taxRates.id, id))
            .limit(1);
          if (!existing) throw new ResourceNotFoundError('tax-rate', id);
          await tx.delete(taxRates).where(eq(taxRates.id, id));
          return { deleted: true } as const;
        }),
    );
    return new NextResponse(null, { status: 204 });
  } catch (err) {
    return mapPromotionError(err);
  }
}
