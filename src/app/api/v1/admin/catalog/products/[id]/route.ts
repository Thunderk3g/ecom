/**
 * GET    /api/v1/admin/catalog/products/[id]  — fetch single product (admin view)
 * PATCH  /api/v1/admin/catalog/products/[id]  — update
 * DELETE /api/v1/admin/catalog/products/[id]  — soft delete
 */

import { NextResponse } from 'next/server';
import { z } from 'zod';
import {
  getProductById,
  updateProduct,
  softDeleteProduct,
} from '@/modules/catalog/products';
import { ProductNotFoundError } from '@/modules/catalog/errors';
import { problem } from '@/lib/errors';
import { withIdempotency } from '@/lib/idempotency';
import { mapCatalogError, readJsonBody, runAdminPipeline } from '../../_lib';

const patchBody = z.object({
  slug: z.string().min(1).optional(),
  name: z.string().min(1).optional(),
  descriptionMd: z.string().nullish(),
  brand: z.string().nullish(),
  categoryId: z.string().uuid().nullish(),
  type: z.enum(['simple', 'bundle']).optional(),
  status: z.enum(['draft', 'active', 'archived']).optional(),
  attributes: z.record(z.unknown()).optional(),
  taxClass: z.string().nullish(),
  seo: z
    .object({
      title: z.string().optional(),
      description: z.string().optional(),
      keywords: z.array(z.string()).optional(),
    })
    .nullish(),
  publishedAt: z.string().datetime().nullish(),
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
    const product = await getProductById(pipeline.storeId, id, { includeDeleted: true });
    if (!product) {
      return problem(404, 'product-not-found', `Product not found: ${id}`, []);
    }
    return NextResponse.json({ data: product });
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
  const validated = patchBody.safeParse(parsed.data);
  if (!validated.success) {
    return problem(
      422,
      'invalid-body',
      'Invalid product patch',
      validated.error.issues.map(i => ({ path: i.path.map(p => String(p)), message: i.message })),
    );
  }

  try {
    const updated = await withIdempotency(
      `admin:catalog:products:patch:${pipeline.storeId}:${id}`,
      pipeline.idempotencyKey!,
      async () =>
        updateProduct(pipeline.storeId, id, {
          ...(validated.data.slug !== undefined ? { slug: validated.data.slug } : {}),
          ...(validated.data.name !== undefined ? { name: validated.data.name } : {}),
          ...(validated.data.descriptionMd !== undefined
            ? { descriptionMd: validated.data.descriptionMd ?? null }
            : {}),
          ...(validated.data.brand !== undefined ? { brand: validated.data.brand ?? null } : {}),
          ...(validated.data.categoryId !== undefined
            ? { categoryId: validated.data.categoryId ?? null }
            : {}),
          ...(validated.data.type !== undefined ? { type: validated.data.type } : {}),
          ...(validated.data.status !== undefined ? { status: validated.data.status } : {}),
          ...(validated.data.attributes !== undefined
            ? { attributes: validated.data.attributes }
            : {}),
          ...(validated.data.taxClass !== undefined
            ? { taxClass: validated.data.taxClass ?? null }
            : {}),
          ...(validated.data.seo !== undefined ? { seo: validated.data.seo ?? null } : {}),
          ...(validated.data.publishedAt !== undefined
            ? {
                publishedAt: validated.data.publishedAt
                  ? new Date(validated.data.publishedAt)
                  : null,
              }
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
      `admin:catalog:products:delete:${pipeline.storeId}:${id}`,
      pipeline.idempotencyKey!,
      async () => {
        await softDeleteProduct(pipeline.storeId, id);
        return { deleted: true } as const;
      },
    );
    return new NextResponse(null, { status: 204 });
  } catch (err) {
    if (err instanceof ProductNotFoundError) {
      return problem(404, 'product-not-found', err.message, []);
    }
    return mapCatalogError(err);
  }
}
