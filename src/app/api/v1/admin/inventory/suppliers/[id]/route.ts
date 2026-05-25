/**
 * GET    /api/v1/admin/inventory/suppliers/[id]
 * PATCH  /api/v1/admin/inventory/suppliers/[id]
 * DELETE /api/v1/admin/inventory/suppliers/[id]  (409 when active POs reference)
 */

import { NextResponse } from 'next/server';
import { z } from 'zod';
import {
  deleteSupplier,
  getSupplier,
  updateSupplier,
} from '@/modules/inventory/suppliers';
import { problem } from '@/lib/errors';
import { withIdempotency } from '@/lib/idempotency';
import { mapInventoryError, readJsonBody, runAdminPipeline } from '../../_lib';

const contactSchema = z
  .object({
    email: z.string().email().optional(),
    phone: z.string().min(1).optional(),
    address: z.string().min(1).optional(),
  })
  .strict();

const patchBody = z.object({
  name: z.string().min(1).optional(),
  contact: contactSchema.nullable().optional(),
  leadTimeDays: z.number().int().nonnegative().nullable().optional(),
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
    const supplier = await getSupplier(pipeline.storeId, id);
    return NextResponse.json({ data: supplier });
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
      'Invalid supplier patch',
      validated.error.issues.map(i => ({ path: i.path.map(p => String(p)), message: i.message })),
    );
  }

  try {
    const updated = await withIdempotency(
      `admin:inventory:suppliers:patch:${pipeline.storeId}:${id}`,
      pipeline.idempotencyKey!,
      async () =>
        updateSupplier(pipeline.storeId, id, {
          ...(validated.data.name !== undefined ? { name: validated.data.name } : {}),
          ...(validated.data.contact !== undefined ? { contact: validated.data.contact } : {}),
          ...(validated.data.leadTimeDays !== undefined
            ? { leadTimeDays: validated.data.leadTimeDays }
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
      `admin:inventory:suppliers:delete:${pipeline.storeId}:${id}`,
      pipeline.idempotencyKey!,
      async () => {
        await deleteSupplier(pipeline.storeId, id);
        return { deleted: true } as const;
      },
    );
    return new NextResponse(null, { status: 204 });
  } catch (err) {
    return mapInventoryError(err);
  }
}
