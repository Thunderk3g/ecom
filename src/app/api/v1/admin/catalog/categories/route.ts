/**
 * GET  /api/v1/admin/catalog/categories  — admin tree (incl. unpublished)
 * POST /api/v1/admin/catalog/categories  — create category
 */

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getAdminCategoryTree, createCategory } from '@/modules/catalog/categories';
import { problem } from '@/lib/errors';
import { withIdempotency } from '@/lib/idempotency';
import { mapCatalogError, readJsonBody, runAdminPipeline } from '../_lib';

const createBody = z.object({
  slug: z.string().min(1),
  name: z.string().min(1),
  parentId: z.string().uuid().nullish(),
  description: z.string().nullish(),
  imageAssetId: z.string().uuid().nullish(),
  sortOrder: z.number().int().optional(),
  published: z.boolean().optional(),
});

export async function GET(req: Request): Promise<NextResponse> {
  const pipeline = await runAdminPipeline(req, {
    requireMutation: false,
    permission: 'catalog:write',
  });
  if (!pipeline.ok) return pipeline.response;

  try {
    const tree = await getAdminCategoryTree(pipeline.storeId);
    return NextResponse.json({ data: tree });
  } catch (err) {
    return mapCatalogError(err);
  }
}

export async function POST(req: Request): Promise<NextResponse> {
  const pipeline = await runAdminPipeline(req, {
    requireMutation: true,
    permission: 'catalog:write',
  });
  if (!pipeline.ok) return pipeline.response;

  const parsed = await readJsonBody(req);
  if (!parsed.ok) return parsed.response;
  const validated = createBody.safeParse(parsed.data);
  if (!validated.success) {
    return problem(
      422,
      'invalid-body',
      'Invalid category body',
      validated.error.issues.map(i => ({ path: i.path.map(p => String(p)), message: i.message })),
    );
  }

  try {
    const category = await withIdempotency(
      `admin:catalog:categories:create:${pipeline.storeId}`,
      pipeline.idempotencyKey!,
      async () =>
        createCategory(pipeline.storeId, {
          slug: validated.data.slug,
          name: validated.data.name,
          parentId: validated.data.parentId ?? null,
          description: validated.data.description ?? null,
          imageAssetId: validated.data.imageAssetId ?? null,
          ...(validated.data.sortOrder !== undefined
            ? { sortOrder: validated.data.sortOrder }
            : {}),
          ...(validated.data.published !== undefined
            ? { published: validated.data.published }
            : {}),
        }),
    );
    return NextResponse.json({ data: category }, { status: 201 });
  } catch (err) {
    return mapCatalogError(err);
  }
}
