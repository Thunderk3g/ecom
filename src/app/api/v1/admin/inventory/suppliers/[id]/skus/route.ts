/**
 * GET  /api/v1/admin/inventory/suppliers/[id]/skus  — list SKUs for supplier
 * POST /api/v1/admin/inventory/suppliers/[id]/skus  — upsert SKU mapping
 *
 * The `supplierId` path parameter takes precedence over any value in the body.
 */

import { NextResponse } from 'next/server';
import { z } from 'zod';
import {
  listSupplierSkus,
  setSupplierSku,
} from '@/modules/inventory/supplier-skus';
import { problem } from '@/lib/errors';
import { withIdempotency } from '@/lib/idempotency';
import { mapInventoryError, readJsonBody, runAdminPipeline } from '../../../_lib';

const upsertBody = z.object({
  variantId: z.string().uuid(),
  supplierSku: z.string().min(1),
  costCents: z.number().int().nonnegative(),
  moq: z.number().int().positive().optional(),
});

type RouteCtx = { params: Promise<{ id: string }> };

export async function GET(req: Request, ctx: RouteCtx): Promise<NextResponse> {
  const pipeline = await runAdminPipeline(req, {
    requireMutation: false,
    permission: 'inventory:read',
  });
  if (!pipeline.ok) return pipeline.response;

  const { id: supplierId } = await ctx.params;
  try {
    const items = await listSupplierSkus(pipeline.storeId, { supplierId });
    return NextResponse.json({ data: items });
  } catch (err) {
    return mapInventoryError(err);
  }
}

export async function POST(req: Request, ctx: RouteCtx): Promise<NextResponse> {
  const pipeline = await runAdminPipeline(req, {
    requireMutation: true,
    permission: 'inventory:write',
  });
  if (!pipeline.ok) return pipeline.response;

  const { id: supplierId } = await ctx.params;
  const parsed = await readJsonBody(req);
  if (!parsed.ok) return parsed.response;
  const validated = upsertBody.safeParse(parsed.data);
  if (!validated.success) {
    return problem(
      422,
      'invalid-body',
      'Invalid supplier sku body',
      validated.error.issues.map(i => ({ path: i.path.map(p => String(p)), message: i.message })),
    );
  }

  try {
    const row = await withIdempotency(
      `admin:inventory:supplier-skus:upsert:${pipeline.storeId}:${supplierId}:${validated.data.variantId}`,
      pipeline.idempotencyKey!,
      async () =>
        setSupplierSku(pipeline.storeId, {
          supplierId,
          variantId: validated.data.variantId,
          supplierSku: validated.data.supplierSku,
          costCents: validated.data.costCents,
          ...(validated.data.moq !== undefined ? { moq: validated.data.moq } : {}),
        }),
    );
    return NextResponse.json({ data: row });
  } catch (err) {
    return mapInventoryError(err);
  }
}
