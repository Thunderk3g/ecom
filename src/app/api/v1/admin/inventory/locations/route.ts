/**
 * SP-3 admin inventory locations endpoint.
 *
 *   GET  /api/v1/admin/inventory/locations   — list all locations for tenant
 *   POST /api/v1/admin/inventory/locations   — create a location
 *
 * GET pipeline:  resolveTenant → getSession → RBAC (`inventory:read`).
 * POST pipeline: GET pipeline + CSRF + Idempotency-Key.
 */

import { NextResponse } from 'next/server';
import { z } from 'zod';
import {
  createLocation,
  listLocations,
  type LocationType,
} from '@/modules/inventory/locations';
import { problem } from '@/lib/errors';
import { withIdempotency } from '@/lib/idempotency';
import { mapInventoryError, readJsonBody, runAdminPipeline } from '../_lib';

const LOCATION_TYPES = ['warehouse', 'store', 'transit'] as const;

const createBody = z.object({
  code: z.string().min(1),
  name: z.string().min(1),
  type: z.enum(LOCATION_TYPES),
});

export async function GET(req: Request): Promise<NextResponse> {
  const pipeline = await runAdminPipeline(req, {
    requireMutation: false,
    permission: 'inventory:read',
  });
  if (!pipeline.ok) return pipeline.response;

  try {
    const items = await listLocations(pipeline.storeId);
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
  const validated = createBody.safeParse(parsed.data);
  if (!validated.success) {
    return problem(
      422,
      'invalid-body',
      'Invalid location body',
      validated.error.issues.map(i => ({ path: i.path.map(p => String(p)), message: i.message })),
    );
  }

  try {
    const location = await withIdempotency(
      `admin:inventory:locations:create:${pipeline.storeId}`,
      pipeline.idempotencyKey!,
      async () =>
        createLocation(pipeline.storeId, {
          code: validated.data.code,
          name: validated.data.name,
          type: validated.data.type as LocationType,
        }),
    );
    return NextResponse.json({ data: location }, { status: 201 });
  } catch (err) {
    return mapInventoryError(err);
  }
}
