/**
 * GET  /api/v1/admin/inventory/suppliers   — cursor-paginated supplier list
 * POST /api/v1/admin/inventory/suppliers   — create supplier
 */

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createSupplier, listSuppliers } from '@/modules/inventory/suppliers';
import { problem } from '@/lib/errors';
import { withIdempotency } from '@/lib/idempotency';
import { mapInventoryError, readJsonBody, runAdminPipeline } from '../_lib';

const contactSchema = z
  .object({
    email: z.string().email().optional(),
    phone: z.string().min(1).optional(),
    address: z.string().min(1).optional(),
  })
  .strict();

const createBody = z.object({
  name: z.string().min(1),
  contact: contactSchema.optional(),
  leadTimeDays: z.number().int().nonnegative().optional(),
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

  try {
    const result = await listSuppliers(pipeline.storeId, {
      ...(cursor !== undefined ? { cursor } : {}),
      ...(limitRaw ? { limit: Number.parseInt(limitRaw, 10) } : {}),
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
      'Invalid supplier body',
      validated.error.issues.map(i => ({ path: i.path.map(p => String(p)), message: i.message })),
    );
  }

  try {
    const supplier = await withIdempotency(
      `admin:inventory:suppliers:create:${pipeline.storeId}`,
      pipeline.idempotencyKey!,
      async () =>
        createSupplier(pipeline.storeId, {
          name: validated.data.name,
          ...(validated.data.contact !== undefined ? { contact: validated.data.contact } : {}),
          ...(validated.data.leadTimeDays !== undefined
            ? { leadTimeDays: validated.data.leadTimeDays }
            : {}),
        }),
    );
    return NextResponse.json({ data: supplier }, { status: 201 });
  } catch (err) {
    return mapInventoryError(err);
  }
}
