/**
 * GET  /api/v1/admin/catalog/products/[id]/variants  — list variants
 * POST /api/v1/admin/catalog/products/[id]/variants  — create variant
 */

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { listVariants, createVariant } from '@/modules/catalog/variants';
import { problem } from '@/lib/errors';
import { withIdempotency } from '@/lib/idempotency';
import { mapCatalogError, readJsonBody, runAdminPipeline } from '../../../_lib';

const createBody = z.object({
  sku: z.string().min(1),
  name: z.string().nullish(),
  barcode: z.string().nullish(),
  axes: z.record(z.union([z.string(), z.number()])).optional(),
  priceCents: z.number().int().nonnegative(),
  compareAtCents: z.number().int().nonnegative().nullish(),
  costCents: z.number().int().nonnegative().nullish(),
  weightG: z.number().int().nonnegative().nullish(),
  status: z.enum(['draft', 'active', 'archived']).optional(),
});

type RouteCtx = { params: Promise<{ id: string }> };

export async function GET(req: Request, ctx: RouteCtx): Promise<NextResponse> {
  const pipeline = await runAdminPipeline(req, {
    requireMutation: false,
    permission: 'catalog:write',
  });
  if (!pipeline.ok) return pipeline.response;

  const { id } = await ctx.params;
  try {
    const variants = await listVariants(pipeline.storeId, id);
    return NextResponse.json({ data: variants });
  } catch (err) {
    return mapCatalogError(err);
  }
}

export async function POST(req: Request, ctx: RouteCtx): Promise<NextResponse> {
  const pipeline = await runAdminPipeline(req, {
    requireMutation: true,
    permission: 'catalog:write',
  });
  if (!pipeline.ok) return pipeline.response;

  const { id } = await ctx.params;
  const parsed = await readJsonBody(req);
  if (!parsed.ok) return parsed.response;
  const validated = createBody.safeParse(parsed.data);
  if (!validated.success) {
    return problem(
      422,
      'invalid-body',
      'Invalid variant body',
      validated.error.issues.map(i => ({ path: i.path.map(p => String(p)), message: i.message })),
    );
  }

  try {
    const variant = await withIdempotency(
      `admin:catalog:variants:create:${pipeline.storeId}:${id}`,
      pipeline.idempotencyKey!,
      async () =>
        createVariant(pipeline.storeId, id, {
          sku: validated.data.sku,
          name: validated.data.name ?? null,
          barcode: validated.data.barcode ?? null,
          axes: validated.data.axes ?? {},
          priceCents: validated.data.priceCents,
          compareAtCents: validated.data.compareAtCents ?? null,
          costCents: validated.data.costCents ?? null,
          weightG: validated.data.weightG ?? null,
          ...(validated.data.status ? { status: validated.data.status } : {}),
        }),
    );
    return NextResponse.json({ data: variant }, { status: 201 });
  } catch (err) {
    return mapCatalogError(err);
  }
}
