/**
 * PATCH  /api/v1/admin/catalog/categories/[id]
 * DELETE /api/v1/admin/catalog/categories/[id]  — 409 if products reference it
 */

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { updateCategory, deleteCategory } from '@/modules/catalog/categories';
import { problem } from '@/lib/errors';
import { withIdempotency } from '@/lib/idempotency';
import { mapCatalogError, readJsonBody, runAdminPipeline } from '../../_lib';

const patchBody = z.object({
  slug: z.string().min(1).optional(),
  name: z.string().min(1).optional(),
  parentId: z.string().uuid().nullish(),
  description: z.string().nullish(),
  imageAssetId: z.string().uuid().nullish(),
  sortOrder: z.number().int().optional(),
  published: z.boolean().optional(),
});

type RouteCtx = { params: Promise<{ id: string }> };

export async function PATCH(req: Request, ctx: RouteCtx): Promise<NextResponse> {
  const pipeline = await runAdminPipeline(req, {
    requireMutation: true,
    permission: 'catalog:write',
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
      'Invalid category patch',
      validated.error.issues.map(i => ({ path: i.path.map(p => String(p)), message: i.message })),
    );
  }

  try {
    const updated = await withIdempotency(
      `admin:catalog:categories:patch:${pipeline.storeId}:${id}`,
      pipeline.idempotencyKey!,
      async () =>
        updateCategory(pipeline.storeId, id, {
          ...(validated.data.slug !== undefined ? { slug: validated.data.slug } : {}),
          ...(validated.data.name !== undefined ? { name: validated.data.name } : {}),
          ...(validated.data.parentId !== undefined
            ? { parentId: validated.data.parentId ?? null }
            : {}),
          ...(validated.data.description !== undefined
            ? { description: validated.data.description ?? null }
            : {}),
          ...(validated.data.imageAssetId !== undefined
            ? { imageAssetId: validated.data.imageAssetId ?? null }
            : {}),
          ...(validated.data.sortOrder !== undefined
            ? { sortOrder: validated.data.sortOrder }
            : {}),
          ...(validated.data.published !== undefined
            ? { published: validated.data.published }
            : {}),
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

  const { id } = await ctx.params;
  try {
    await withIdempotency(
      `admin:catalog:categories:delete:${pipeline.storeId}:${id}`,
      pipeline.idempotencyKey!,
      async () => {
        await deleteCategory(pipeline.storeId, id, { blockIfProductsExist: true });
        return { deleted: true } as const;
      },
    );
    return new NextResponse(null, { status: 204 });
  } catch (err) {
    return mapCatalogError(err);
  }
}
