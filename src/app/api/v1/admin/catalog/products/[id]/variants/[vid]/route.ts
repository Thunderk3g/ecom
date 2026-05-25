/**
 * PATCH  /api/v1/admin/catalog/products/[id]/variants/[vid]  — update variant
 * DELETE /api/v1/admin/catalog/products/[id]/variants/[vid]  — hard delete variant
 *
 * Note: variants are hard-deleted (not soft) because line-item history in SP-5
 * is preserved via a denormalized snapshot on the order row, not the variant FK.
 */

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { updateVariant, deleteVariant } from '@/modules/catalog/variants';
import { problem } from '@/lib/errors';
import { withIdempotency } from '@/lib/idempotency';
import { mapCatalogError, readJsonBody, runAdminPipeline } from '../../../../_lib';

const patchBody = z.object({
  sku: z.string().min(1).optional(),
  name: z.string().nullish(),
  barcode: z.string().nullish(),
  axes: z.record(z.union([z.string(), z.number()])).optional(),
  priceCents: z.number().int().nonnegative().optional(),
  compareAtCents: z.number().int().nonnegative().nullish(),
  costCents: z.number().int().nonnegative().nullish(),
  weightG: z.number().int().nonnegative().nullish(),
  status: z.enum(['draft', 'active', 'archived']).optional(),
});

type RouteCtx = { params: Promise<{ id: string; vid: string }> };

export async function PATCH(req: Request, ctx: RouteCtx): Promise<NextResponse> {
  const pipeline = await runAdminPipeline(req, {
    requireMutation: true,
    permission: 'catalog:write',
  });
  if (!pipeline.ok) return pipeline.response;

  const { vid } = await ctx.params;
  const parsed = await readJsonBody(req);
  if (!parsed.ok) return parsed.response;
  const validated = patchBody.safeParse(parsed.data);
  if (!validated.success) {
    return problem(
      422,
      'invalid-body',
      'Invalid variant patch',
      validated.error.issues.map(i => ({ path: i.path.map(p => String(p)), message: i.message })),
    );
  }

  try {
    const updated = await withIdempotency(
      `admin:catalog:variants:patch:${pipeline.storeId}:${vid}`,
      pipeline.idempotencyKey!,
      async () =>
        updateVariant(pipeline.storeId, vid, {
          ...(validated.data.sku !== undefined ? { sku: validated.data.sku } : {}),
          ...(validated.data.name !== undefined ? { name: validated.data.name ?? null } : {}),
          ...(validated.data.barcode !== undefined
            ? { barcode: validated.data.barcode ?? null }
            : {}),
          ...(validated.data.axes !== undefined ? { axes: validated.data.axes } : {}),
          ...(validated.data.priceCents !== undefined
            ? { priceCents: validated.data.priceCents }
            : {}),
          ...(validated.data.compareAtCents !== undefined
            ? { compareAtCents: validated.data.compareAtCents ?? null }
            : {}),
          ...(validated.data.costCents !== undefined
            ? { costCents: validated.data.costCents ?? null }
            : {}),
          ...(validated.data.weightG !== undefined
            ? { weightG: validated.data.weightG ?? null }
            : {}),
          ...(validated.data.status !== undefined ? { status: validated.data.status } : {}),
        }),
    );
    return NextResponse.json({ data: updated });
  } catch (err) {
    return mapCatalogError(err);
  }
}

export async function DELETE(req: Request, ctx: RouteCtx): Promise<NextResponse> {
  const pipeline = await runAdminPipeline(req, {
    requireMutation: true,
    permission: 'catalog:write',
  });
  if (!pipeline.ok) return pipeline.response;

  const { vid } = await ctx.params;
  try {
    await withIdempotency(
      `admin:catalog:variants:delete:${pipeline.storeId}:${vid}`,
      pipeline.idempotencyKey!,
      async () => {
        await deleteVariant(pipeline.storeId, vid);
        return { deleted: true } as const;
      },
    );
    return new NextResponse(null, { status: 204 });
  } catch (err) {
    return mapCatalogError(err);
  }
}
