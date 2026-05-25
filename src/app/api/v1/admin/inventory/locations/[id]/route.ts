/**
 * PATCH  /api/v1/admin/inventory/locations/[id]  — update mutable fields
 * DELETE /api/v1/admin/inventory/locations/[id]  — hard delete (409 if in use)
 */

import { NextResponse } from 'next/server';
import { z } from 'zod';
import {
  deleteLocation,
  updateLocation,
  type LocationType,
} from '@/modules/inventory/locations';
import { problem } from '@/lib/errors';
import { withIdempotency } from '@/lib/idempotency';
import { mapInventoryError, readJsonBody, runAdminPipeline } from '../../_lib';

const LOCATION_TYPES = ['warehouse', 'store', 'transit'] as const;

const patchBody = z.object({
  code: z.string().min(1).optional(),
  name: z.string().min(1).optional(),
  type: z.enum(LOCATION_TYPES).optional(),
});

type RouteCtx = { params: Promise<{ id: string }> };

export async function PATCH(req: Request, ctx: RouteCtx): Promise<NextResponse> {
  const pipeline = await runAdminPipeline(req, {
    requireMutation: true,
    permission: 'inventory:write',
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
      'Invalid location patch',
      validated.error.issues.map(i => ({ path: i.path.map(p => String(p)), message: i.message })),
    );
  }

  try {
    const updated = await withIdempotency(
      `admin:inventory:locations:patch:${pipeline.storeId}:${id}`,
      pipeline.idempotencyKey!,
      async () =>
        updateLocation(pipeline.storeId, id, {
          ...(validated.data.code !== undefined ? { code: validated.data.code } : {}),
          ...(validated.data.name !== undefined ? { name: validated.data.name } : {}),
          ...(validated.data.type !== undefined
            ? { type: validated.data.type as LocationType }
            : {}),
        }),
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

  const { id } = await ctx.params;
  try {
    await withIdempotency(
      `admin:inventory:locations:delete:${pipeline.storeId}:${id}`,
      pipeline.idempotencyKey!,
      async () => {
        await deleteLocation(pipeline.storeId, id);
        return { deleted: true } as const;
      },
    );
    return new NextResponse(null, { status: 204 });
  } catch (err) {
    return mapInventoryError(err);
  }
}
