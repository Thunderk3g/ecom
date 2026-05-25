/**
 * DELETE /api/v1/admin/catalog/products/[id]/images/[iid]
 */

import { NextResponse } from 'next/server';
import { detachImage } from '@/modules/catalog/images';
import { withIdempotency } from '@/lib/idempotency';
import { mapCatalogError, runAdminPipeline } from '../../../../_lib';

type RouteCtx = { params: Promise<{ id: string; iid: string }> };

export async function DELETE(req: Request, ctx: RouteCtx): Promise<NextResponse> {
  const pipeline = await runAdminPipeline(req, {
    requireMutation: true,
    permission: 'catalog:write',
  });
  if (!pipeline.ok) return pipeline.response;

  const { iid } = await ctx.params;
  try {
    await withIdempotency(
      `admin:catalog:images:detach:${pipeline.storeId}:${iid}`,
      pipeline.idempotencyKey!,
      async () => {
        await detachImage(pipeline.storeId, iid);
        return { deleted: true } as const;
      },
    );
    return new NextResponse(null, { status: 204 });
  } catch (err) {
    return mapCatalogError(err);
  }
}
