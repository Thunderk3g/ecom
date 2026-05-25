/**
 * PATCH  /api/v1/admin/inventory/thresholds/[variantId]/[locationId]
 * DELETE /api/v1/admin/inventory/thresholds/[variantId]/[locationId]
 *
 * PATCH partial update via `setThreshold` (the underlying upsert needs both
 * fields, so a 404 is raised first when the row doesn't exist to preserve
 * "PATCH must target an existing resource" semantics).
 */

import { NextResponse } from 'next/server';
import { z } from 'zod';
import {
  deleteThreshold,
  getThreshold,
  setThreshold,
} from '@/modules/inventory/thresholds';
import { problem } from '@/lib/errors';
import { withIdempotency } from '@/lib/idempotency';
import { mapInventoryError, readJsonBody, runAdminPipeline } from '../../../_lib';

const patchBody = z.object({
  reorderPoint: z.number().int().nonnegative().optional(),
  reorderQty: z.number().int().positive().optional(),
});

type RouteCtx = { params: Promise<{ variantId: string; locationId: string }> };

export async function PATCH(req: Request, ctx: RouteCtx): Promise<NextResponse> {
  const pipeline = await runAdminPipeline(req, {
    requireMutation: true,
    permission: 'inventory:write',
  });
  if (!pipeline.ok) return pipeline.response;

  const { variantId, locationId } = await ctx.params;
  const parsed = await readJsonBody(req);
  if (!parsed.ok) return parsed.response;
  const validated = patchBody.safeParse(parsed.data);
  if (!validated.success) {
    return problem(
      422,
      'invalid-body',
      'Invalid threshold patch',
      validated.error.issues.map(i => ({ path: i.path.map(p => String(p)), message: i.message })),
    );
  }

  try {
    const updated = await withIdempotency(
      `admin:inventory:thresholds:patch:${pipeline.storeId}:${variantId}:${locationId}`,
      pipeline.idempotencyKey!,
      async () => {
        // Ensure the row exists — surfaces ThresholdNotFoundError → 404.
        const existing = await getThreshold(pipeline.storeId, variantId, locationId);
        return setThreshold(pipeline.storeId, {
          variantId,
          locationId,
          reorderPoint:
            validated.data.reorderPoint !== undefined
              ? validated.data.reorderPoint
              : existing.reorderPoint,
          reorderQty:
            validated.data.reorderQty !== undefined
              ? validated.data.reorderQty
              : existing.reorderQty,
        });
      },
    );
    return NextResponse.json({ data: updated });
  } catch (err) {
    return mapInventoryError(err);
  }
}

export async function DELETE(req: Request, ctx: RouteCtx): Promise<NextResponse> {
  const pipeline = await runAdminPipeline(req, {
    requireMutation: true,
    permission: 'inventory:write',
  });
  if (!pipeline.ok) return pipeline.response;

  const { variantId, locationId } = await ctx.params;
  try {
    await withIdempotency(
      `admin:inventory:thresholds:delete:${pipeline.storeId}:${variantId}:${locationId}`,
      pipeline.idempotencyKey!,
      async () => {
        await deleteThreshold(pipeline.storeId, variantId, locationId);
        return { deleted: true } as const;
      },
    );
    return new NextResponse(null, { status: 204 });
  } catch (err) {
    return mapInventoryError(err);
  }
}
