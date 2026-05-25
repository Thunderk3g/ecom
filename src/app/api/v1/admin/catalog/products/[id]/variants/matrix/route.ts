/**
 * POST /api/v1/admin/catalog/products/[id]/variants/matrix
 *
 * Cartesian-product variant creation. Body:
 *   {
 *     axes: { size: ['A4','A5'], color: ['red','blue'] },
 *     base: { priceCents: 1999, ... , skuPrefix?: 'NB-2024' }
 *   }
 */

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { matrixCreate } from '@/modules/catalog/variants';
import { problem } from '@/lib/errors';
import { withIdempotency } from '@/lib/idempotency';
import { mapCatalogError, readJsonBody, runAdminPipeline } from '../../../../_lib';

const body = z.object({
  axes: z
    .record(z.array(z.string().min(1)).min(1))
    .refine(o => Object.keys(o).length > 0, { message: 'axes must have at least one dimension' }),
  base: z.object({
    name: z.string().nullish(),
    barcode: z.string().nullish(),
    priceCents: z.number().int().nonnegative(),
    compareAtCents: z.number().int().nonnegative().nullish(),
    costCents: z.number().int().nonnegative().nullish(),
    weightG: z.number().int().nonnegative().nullish(),
    status: z.enum(['draft', 'active', 'archived']).optional(),
    skuPrefix: z.string().min(1).optional(),
  }),
});

type RouteCtx = { params: Promise<{ id: string }> };

export async function POST(req: Request, ctx: RouteCtx): Promise<NextResponse> {
  const pipeline = await runAdminPipeline(req, {
    requireMutation: true,
    permission: 'catalog:write',
  });
  if (!pipeline.ok) return pipeline.response;

  const { id } = await ctx.params;
  const parsed = await readJsonBody(req);
  if (!parsed.ok) return parsed.response;
  const validated = body.safeParse(parsed.data);
  if (!validated.success) {
    return problem(
      422,
      'invalid-body',
      'Invalid matrix body',
      validated.error.issues.map(i => ({ path: i.path.map(p => String(p)), message: i.message })),
    );
  }

  try {
    const variants = await withIdempotency(
      `admin:catalog:variants:matrix:${pipeline.storeId}:${id}`,
      pipeline.idempotencyKey!,
      async () =>
        matrixCreate(pipeline.storeId, id, validated.data.axes, {
          name: validated.data.base.name ?? null,
          barcode: validated.data.base.barcode ?? null,
          priceCents: validated.data.base.priceCents,
          compareAtCents: validated.data.base.compareAtCents ?? null,
          costCents: validated.data.base.costCents ?? null,
          weightG: validated.data.base.weightG ?? null,
          ...(validated.data.base.status ? { status: validated.data.base.status } : {}),
          ...(validated.data.base.skuPrefix ? { skuPrefix: validated.data.base.skuPrefix } : {}),
        }),
    );
    return NextResponse.json({ data: variants }, { status: 201 });
  } catch (err) {
    return mapCatalogError(err);
  }
}
