/**
 * GET  /api/v1/admin/inventory/purchase-orders   — cursor-paginated list
 * POST /api/v1/admin/inventory/purchase-orders   — create PO (with items)
 */

import { NextResponse } from 'next/server';
import { z } from 'zod';
import {
  createPurchaseOrder,
  listPurchaseOrders,
  type PoStatus,
} from '@/modules/inventory/purchase-orders';
import { problem } from '@/lib/errors';
import { withIdempotency } from '@/lib/idempotency';
import { mapInventoryError, readJsonBody, runAdminPipeline } from '../_lib';

const PO_STATUSES = ['draft', 'placed', 'partial', 'received', 'cancelled'] as const;

const createBody = z.object({
  supplierId: z.string().uuid(),
  status: z.enum(PO_STATUSES).optional(),
  placedAt: z.string().datetime().nullable().optional(),
  expectedAt: z.string().datetime().nullable().optional(),
  items: z
    .array(
      z.object({
        variantId: z.string().uuid(),
        qtyOrdered: z.number().int().positive(),
        costCents: z.number().int().nonnegative(),
      }),
    )
    .min(1),
});

export async function GET(req: Request): Promise<NextResponse> {
  const pipeline = await runAdminPipeline(req, {
    requireMutation: false,
    permission: 'inventory:read',
  });
  if (!pipeline.ok) return pipeline.response;

  const url = new URL(req.url);
  const cursor = url.searchParams.get('after') ?? undefined;
  const limitRaw = url.searchParams.get('limit');
  const supplierId = url.searchParams.get('supplierId') ?? undefined;
  const statusRaw = url.searchParams.get('status');
  const status =
    statusRaw && (PO_STATUSES as readonly string[]).includes(statusRaw)
      ? (statusRaw as PoStatus)
      : undefined;

  try {
    const result = await listPurchaseOrders(pipeline.storeId, {
      ...(cursor !== undefined ? { cursor } : {}),
      ...(limitRaw ? { limit: Number.parseInt(limitRaw, 10) } : {}),
      ...(supplierId !== undefined ? { supplierId } : {}),
      ...(status !== undefined ? { status } : {}),
    });
    return NextResponse.json({
      data: result.items,
      page: { nextCursor: result.nextCursor },
    });
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
      'Invalid purchase order body',
      validated.error.issues.map(i => ({ path: i.path.map(p => String(p)), message: i.message })),
    );
  }

  try {
    const po = await withIdempotency(
      `admin:inventory:purchase-orders:create:${pipeline.storeId}`,
      pipeline.idempotencyKey!,
      async () =>
        createPurchaseOrder(pipeline.storeId, {
          supplierId: validated.data.supplierId,
          ...(validated.data.status !== undefined ? { status: validated.data.status } : {}),
          ...(validated.data.placedAt !== undefined
            ? { placedAt: validated.data.placedAt ? new Date(validated.data.placedAt) : null }
            : {}),
          ...(validated.data.expectedAt !== undefined
            ? { expectedAt: validated.data.expectedAt ? new Date(validated.data.expectedAt) : null }
            : {}),
          items: validated.data.items.map(it => ({
            variantId: it.variantId,
            qtyOrdered: it.qtyOrdered,
            costCents: it.costCents,
          })),
        }),
    );
    return NextResponse.json({ data: po }, { status: 201 });
  } catch (err) {
    return mapInventoryError(err);
  }
}
