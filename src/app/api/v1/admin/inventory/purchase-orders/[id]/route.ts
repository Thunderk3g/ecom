/**
 * GET   /api/v1/admin/inventory/purchase-orders/[id]  — fetch PO + items
 * PATCH /api/v1/admin/inventory/purchase-orders/[id]  — update mutable fields
 *
 * Items are immutable here — see the module-level comment in
 * `purchase-orders.ts`. To amend lines, cancel and create a new PO.
 */

import { NextResponse } from 'next/server';
import { z } from 'zod';
import {
  getPurchaseOrder,
  updatePurchaseOrder,
  type PoStatus,
} from '@/modules/inventory/purchase-orders';
import { problem } from '@/lib/errors';
import { withIdempotency } from '@/lib/idempotency';
import { mapInventoryError, readJsonBody, runAdminPipeline } from '../../_lib';

const PO_STATUSES = ['draft', 'placed', 'partial', 'received', 'cancelled'] as const;

const patchBody = z.object({
  status: z.enum(PO_STATUSES).optional(),
  placedAt: z.string().datetime().nullable().optional(),
  expectedAt: z.string().datetime().nullable().optional(),
});

type RouteCtx = { params: Promise<{ id: string }> };

export async function GET(req: Request, ctx: RouteCtx): Promise<NextResponse> {
  const pipeline = await runAdminPipeline(req, {
    requireMutation: false,
    permission: 'inventory:read',
  });
  if (!pipeline.ok) return pipeline.response;

  const { id } = await ctx.params;
  try {
    const po = await getPurchaseOrder(pipeline.storeId, id);
    return NextResponse.json({ data: po });
  } catch (err) {
    return mapInventoryError(err);
  }
}

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
      'Invalid purchase order patch',
      validated.error.issues.map(i => ({ path: i.path.map(p => String(p)), message: i.message })),
    );
  }

  try {
    const updated = await withIdempotency(
      `admin:inventory:purchase-orders:patch:${pipeline.storeId}:${id}`,
      pipeline.idempotencyKey!,
      async () =>
        updatePurchaseOrder(pipeline.storeId, id, {
          ...(validated.data.status !== undefined
            ? { status: validated.data.status as PoStatus }
            : {}),
          ...(validated.data.placedAt !== undefined
            ? { placedAt: validated.data.placedAt ? new Date(validated.data.placedAt) : null }
            : {}),
          ...(validated.data.expectedAt !== undefined
            ? { expectedAt: validated.data.expectedAt ? new Date(validated.data.expectedAt) : null }
            : {}),
        }),
    );
    return NextResponse.json({ data: updated });
  } catch (err) {
    return mapInventoryError(err);
  }
}
