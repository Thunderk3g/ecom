/**
 * Bundle component endpoints.
 *
 * POST   /api/v1/admin/catalog/bundles/[productId]/components
 *        body: { bundleVariantId, componentVariantId, qty }
 * DELETE /api/v1/admin/catalog/bundles/[productId]/components
 *        body: { bundleVariantId, componentVariantId }
 *
 * The `productId` path segment is the bundle product owning the bundle variant.
 * It's accepted for symmetry / future hierarchical authorisation; the module
 * service already verifies that `bundleVariantId` belongs to a `type='bundle'`
 * product within the tenant.
 */

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { addBundleComponent, removeBundleComponent } from '@/modules/catalog/bundles';
import { problem } from '@/lib/errors';
import { withIdempotency } from '@/lib/idempotency';
import { mapCatalogError, readJsonBody, runAdminPipeline } from '../../../_lib';

const postBody = z.object({
  bundleVariantId: z.string().uuid(),
  componentVariantId: z.string().uuid(),
  qty: z.number().int().positive(),
});

const deleteBody = z.object({
  bundleVariantId: z.string().uuid(),
  componentVariantId: z.string().uuid(),
});

type RouteCtx = { params: Promise<{ productId: string }> };

export async function POST(req: Request, ctx: RouteCtx): Promise<NextResponse> {
  const pipeline = await runAdminPipeline(req, {
    requireMutation: true,
    permission: 'catalog:write',
  });
  if (!pipeline.ok) return pipeline.response;

  const { productId } = await ctx.params;
  const parsed = await readJsonBody(req);
  if (!parsed.ok) return parsed.response;
  const validated = postBody.safeParse(parsed.data);
  if (!validated.success) {
    return problem(
      422,
      'invalid-body',
      'Invalid bundle component body',
      validated.error.issues.map(i => ({ path: i.path.map(p => String(p)), message: i.message })),
    );
  }

  try {
    await withIdempotency(
      `admin:catalog:bundles:add:${pipeline.storeId}:${productId}:${validated.data.bundleVariantId}:${validated.data.componentVariantId}`,
      pipeline.idempotencyKey!,
      async () => {
        await addBundleComponent(
          pipeline.storeId,
          validated.data.bundleVariantId,
          validated.data.componentVariantId,
          validated.data.qty,
        );
        return { added: true } as const;
      },
    );
    return NextResponse.json(
      {
        data: {
          bundleVariantId: validated.data.bundleVariantId,
          componentVariantId: validated.data.componentVariantId,
          qty: validated.data.qty,
        },
      },
      { status: 201 },
    );
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

  const { productId } = await ctx.params;
  const parsed = await readJsonBody(req);
  if (!parsed.ok) return parsed.response;
  const validated = deleteBody.safeParse(parsed.data);
  if (!validated.success) {
    return problem(
      422,
      'invalid-body',
      'Invalid bundle component body',
      validated.error.issues.map(i => ({ path: i.path.map(p => String(p)), message: i.message })),
    );
  }

  try {
    await withIdempotency(
      `admin:catalog:bundles:del:${pipeline.storeId}:${productId}:${validated.data.bundleVariantId}:${validated.data.componentVariantId}`,
      pipeline.idempotencyKey!,
      async () => {
        await removeBundleComponent(
          pipeline.storeId,
          validated.data.bundleVariantId,
          validated.data.componentVariantId,
        );
        return { deleted: true } as const;
      },
    );
    return new NextResponse(null, { status: 204 });
  } catch (err) {
    return mapCatalogError(err);
  }
}
