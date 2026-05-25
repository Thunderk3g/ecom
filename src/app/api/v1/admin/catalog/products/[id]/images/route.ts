/**
 * POST  /api/v1/admin/catalog/products/[id]/images  — attach an asset
 * PATCH /api/v1/admin/catalog/products/[id]/images  — reorder { orderedIds: [...] }
 */

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { attachImage, reorderImages } from '@/modules/catalog/images';
import { problem } from '@/lib/errors';
import { withIdempotency } from '@/lib/idempotency';
import { mapCatalogError, readJsonBody, runAdminPipeline } from '../../../_lib';

const attachBody = z.object({
  assetId: z.string().uuid(),
  variantId: z.string().uuid().nullish(),
  alt: z.string().nullish(),
  sortOrder: z.number().int().nonnegative().optional(),
});

const reorderBody = z.object({
  orderedIds: z.array(z.string().uuid()).min(1),
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
  const validated = attachBody.safeParse(parsed.data);
  if (!validated.success) {
    return problem(
      422,
      'invalid-body',
      'Invalid image attach body',
      validated.error.issues.map(i => ({ path: i.path.map(p => String(p)), message: i.message })),
    );
  }

  try {
    const image = await withIdempotency(
      `admin:catalog:images:attach:${pipeline.storeId}:${id}`,
      pipeline.idempotencyKey!,
      async () =>
        attachImage(pipeline.storeId, id, {
          assetId: validated.data.assetId,
          variantId: validated.data.variantId ?? null,
          alt: validated.data.alt ?? null,
          ...(validated.data.sortOrder !== undefined
            ? { sortOrder: validated.data.sortOrder }
            : {}),
        }),
    );
    return NextResponse.json({ data: image }, { status: 201 });
  } catch (err) {
    return mapCatalogError(err);
  }
}

export async function PATCH(req: Request, ctx: RouteCtx): Promise<NextResponse> {
  const pipeline = await runAdminPipeline(req, {
    requireMutation: true,
    permission: 'catalog:write',
  });
  if (!pipeline.ok) return pipeline.response;

  const { id } = await ctx.params;
  const parsed = await readJsonBody(req);
  if (!parsed.ok) return parsed.response;
  const validated = reorderBody.safeParse(parsed.data);
  if (!validated.success) {
    return problem(
      422,
      'invalid-body',
      'Invalid reorder body',
      validated.error.issues.map(i => ({ path: i.path.map(p => String(p)), message: i.message })),
    );
  }

  try {
    await withIdempotency(
      `admin:catalog:images:reorder:${pipeline.storeId}:${id}`,
      pipeline.idempotencyKey!,
      async () => {
        await reorderImages(pipeline.storeId, id, validated.data.orderedIds);
        return { reordered: true } as const;
      },
    );
    return NextResponse.json({ data: { reordered: true } });
  } catch (err) {
    return mapCatalogError(err);
  }
}
