/**
 * PATCH  /api/v1/admin/catalog/attributes/[id]
 * DELETE /api/v1/admin/catalog/attributes/[id]  — 409 if products reference it
 */

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { updateAttribute, deleteAttribute } from '@/modules/catalog/attributes';
import { problem } from '@/lib/errors';
import { withIdempotency } from '@/lib/idempotency';
import { mapCatalogError, readJsonBody, runAdminPipeline } from '../../_lib';

const patchBody = z.object({
  label: z.string().min(1).optional(),
  dataType: z.enum(['string', 'number', 'bool', 'enum']).optional(),
  unit: z.string().nullish(),
  enumValues: z.array(z.string().min(1)).nullish(),
  filterable: z.boolean().optional(),
  required: z.boolean().optional(),
});

type RouteCtx = { params: Promise<{ id: string }> };

export async function PATCH(req: Request, ctx: RouteCtx): Promise<NextResponse> {
  const pipeline = await runAdminPipeline(req, {
    requireMutation: true,
    permission: 'catalog:write',
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
      'Invalid attribute patch',
      validated.error.issues.map(i => ({ path: i.path.map(p => String(p)), message: i.message })),
    );
  }

  try {
    const updated = await withIdempotency(
      `admin:catalog:attributes:patch:${pipeline.storeId}:${id}`,
      pipeline.idempotencyKey!,
      async () =>
        updateAttribute(pipeline.storeId, id, {
          ...(validated.data.label !== undefined ? { label: validated.data.label } : {}),
          ...(validated.data.dataType !== undefined ? { dataType: validated.data.dataType } : {}),
          ...(validated.data.unit !== undefined ? { unit: validated.data.unit ?? null } : {}),
          ...(validated.data.enumValues !== undefined
            ? { enumValues: validated.data.enumValues ?? null }
            : {}),
          ...(validated.data.filterable !== undefined
            ? { filterable: validated.data.filterable }
            : {}),
          ...(validated.data.required !== undefined ? { required: validated.data.required } : {}),
        }),
    );
    return NextResponse.json({ data: updated });
  } catch (err) {
    return mapCatalogError(err);
  }
}

export async function DELETE(req: Request, ctx: RouteCtx): Promise<NextResponse> {
  const pipeline = await runAdminPipeline(req, {
    requireMutation: true,
    permission: 'catalog:write',
  });
  if (!pipeline.ok) return pipeline.response;

  const { id } = await ctx.params;
  try {
    await withIdempotency(
      `admin:catalog:attributes:delete:${pipeline.storeId}:${id}`,
      pipeline.idempotencyKey!,
      async () => {
        await deleteAttribute(pipeline.storeId, id, { blockIfProductsUseIt: true });
        return { deleted: true } as const;
      },
    );
    return new NextResponse(null, { status: 204 });
  } catch (err) {
    return mapCatalogError(err);
  }
}
