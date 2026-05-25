/**
 * GET  /api/v1/admin/inventory/thresholds   — list thresholds (filterable)
 * POST /api/v1/admin/inventory/thresholds   — upsert a threshold via setThreshold()
 */

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { listThresholds, setThreshold } from '@/modules/inventory/thresholds';
import { problem } from '@/lib/errors';
import { withIdempotency } from '@/lib/idempotency';
import { mapInventoryError, readJsonBody, runAdminPipeline } from '../_lib';

const upsertBody = z.object({
  variantId: z.string().uuid(),
  locationId: z.string().uuid(),
  reorderPoint: z.number().int().nonnegative(),
  reorderQty: z.number().int().positive(),
});

export async function GET(req: Request): Promise<NextResponse> {
  const pipeline = await runAdminPipeline(req, {
    requireMutation: false,
    permission: 'inventory:read',
  });
  if (!pipeline.ok) return pipeline.response;

  const url = new URL(req.url);
  const variantId = url.searchParams.get('variantId') ?? undefined;
  const locationId = url.searchParams.get('locationId') ?? undefined;

  try {
    const items = await listThresholds(pipeline.storeId, {
      ...(variantId !== undefined ? { variantId } : {}),
      ...(locationId !== undefined ? { locationId } : {}),
    });
    return NextResponse.json({ data: items });
  } catch (err) {
    return mapInventoryError(err);
  }
}

export async function POST(req: Request): Promise<NextResponse> {
  const pipeline = await runAdminPipeline(req, {
    requireMutation: true,
    permission: 'inventory:write',
  });
  if (!pipeline.ok) return pipeline.response;

  const parsed = await readJsonBody(req);
  if (!parsed.ok) return parsed.response;
  const validated = upsertBody.safeParse(parsed.data);
  if (!validated.success) {
    return problem(
      422,
      'invalid-body',
      'Invalid threshold body',
      validated.error.issues.map(i => ({ path: i.path.map(p => String(p)), message: i.message })),
    );
  }

  try {
    const row = await withIdempotency(
      `admin:inventory:thresholds:upsert:${pipeline.storeId}:${validated.data.variantId}:${validated.data.locationId}`,
      pipeline.idempotencyKey!,
      async () =>
        setThreshold(pipeline.storeId, {
          variantId: validated.data.variantId,
          locationId: validated.data.locationId,
          reorderPoint: validated.data.reorderPoint,
          reorderQty: validated.data.reorderQty,
        }),
    );
    return NextResponse.json({ data: row });
  } catch (err) {
    return mapInventoryError(err);
  }
}
