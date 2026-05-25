/**
 * PATCH  /api/v1/admin/inventory/suppliers/[id]/skus/[variantId]
 * DELETE /api/v1/admin/inventory/suppliers/[id]/skus/[variantId]
 *
 * PATCH proxies to `setSupplierSku` (the underlying upsert); to preserve
 * "PATCH targets an existing resource" semantics, we look up the row first
 * and merge missing fields from it. Missing row → 404
 * (`SupplierNotFoundError` is also surfaced as 404 by the helper).
 */

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { and, eq } from 'drizzle-orm';
import { withTenant } from '@/modules/tenant/with-tenant';
import { supplierSkus } from '@/db/schema/inventory';
import {
  deleteSupplierSku,
  setSupplierSku,
} from '@/modules/inventory/supplier-skus';
import { problem } from '@/lib/errors';
import { withIdempotency } from '@/lib/idempotency';
import { mapInventoryError, readJsonBody, runAdminPipeline } from '../../../../_lib';

const patchBody = z.object({
  supplierSku: z.string().min(1).optional(),
  costCents: z.number().int().nonnegative().optional(),
  moq: z.number().int().positive().optional(),
});

type RouteCtx = { params: Promise<{ id: string; variantId: string }> };

export async function PATCH(req: Request, ctx: RouteCtx): Promise<NextResponse> {
  const pipeline = await runAdminPipeline(req, {
    requireMutation: true,
    permission: 'inventory:write',
  });
  if (!pipeline.ok) return pipeline.response;

  const { id: supplierId, variantId } = await ctx.params;
  const parsed = await readJsonBody(req);
  if (!parsed.ok) return parsed.response;
  const validated = patchBody.safeParse(parsed.data);
  if (!validated.success) {
    return problem(
      422,
      'invalid-body',
      'Invalid supplier sku patch',
      validated.error.issues.map(i => ({ path: i.path.map(p => String(p)), message: i.message })),
    );
  }

  try {
    const updated = await withIdempotency(
      `admin:inventory:supplier-skus:patch:${pipeline.storeId}:${supplierId}:${variantId}`,
      pipeline.idempotencyKey!,
      async () => {
        const existing = await withTenant(pipeline.storeId, async tx => {
          const [row] = await tx
            .select()
            .from(supplierSkus)
            .where(
              and(
                eq(supplierSkus.supplierId, supplierId),
                eq(supplierSkus.variantId, variantId),
              ),
            );
          return row;
        });
        if (!existing) {
          throw new SupplierSkuNotFound();
        }
        return setSupplierSku(pipeline.storeId, {
          supplierId,
          variantId,
          supplierSku:
            validated.data.supplierSku !== undefined
              ? validated.data.supplierSku
              : existing.supplierSku,
          costCents:
            validated.data.costCents !== undefined
              ? validated.data.costCents
              : existing.costCents,
          ...(validated.data.moq !== undefined ? { moq: validated.data.moq } : { moq: existing.moq }),
        });
      },
    );
    return NextResponse.json({ data: updated });
  } catch (err) {
    if (err instanceof SupplierSkuNotFound) {
      return problem(
        404,
        'supplier-sku-not-found',
        `Supplier SKU not found for (supplier=${supplierId}, variant=${variantId})`,
        [],
      );
    }
    return mapInventoryError(err);
  }
}

export async function DELETE(req: Request, ctx: RouteCtx): Promise<NextResponse> {
  const pipeline = await runAdminPipeline(req, {
    requireMutation: true,
    permission: 'inventory:write',
  });
  if (!pipeline.ok) return pipeline.response;

  const { id: supplierId, variantId } = await ctx.params;
  try {
    await withIdempotency(
      `admin:inventory:supplier-skus:delete:${pipeline.storeId}:${supplierId}:${variantId}`,
      pipeline.idempotencyKey!,
      async () => {
        await deleteSupplierSku(pipeline.storeId, supplierId, variantId);
        return { deleted: true } as const;
      },
    );
    return new NextResponse(null, { status: 204 });
  } catch (err) {
    return mapInventoryError(err);
  }
}

/**
 * Local sentinel for "supplier sku row missing" used by PATCH so we can map it
 * to a clean 404 without inventing a new domain error class (the module
 * service intentionally omits one — it's a pure upsert table).
 */
class SupplierSkuNotFound extends Error {
  constructor() {
    super('supplier sku not found');
    this.name = 'SupplierSkuNotFound';
  }
}
