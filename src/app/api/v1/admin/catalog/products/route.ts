/**
 * SP-2 admin catalog products endpoint.
 *
 *   GET  /api/v1/admin/catalog/products   — list (incl. draft + archived)
 *   POST /api/v1/admin/catalog/products   — create
 *
 * GET pipeline: resolveTenant → getSession → RBAC (catalog:write).
 * POST pipeline: GET + CSRF + Idempotency-Key.
 */

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { listProducts, createProduct } from '@/modules/catalog/products';
import { problem } from '@/lib/errors';
import { withIdempotency } from '@/lib/idempotency';
import { mapCatalogError, readJsonBody, runAdminPipeline } from '../_lib';

const STATUSES = ['draft', 'active', 'archived'] as const;

const createBody = z.object({
  slug: z.string().min(1),
  name: z.string().min(1),
  descriptionMd: z.string().nullish(),
  brand: z.string().nullish(),
  categoryId: z.string().uuid().nullish(),
  type: z.enum(['simple', 'bundle']).optional(),
  status: z.enum(STATUSES).optional(),
  attributes: z.record(z.unknown()).optional(),
  taxClass: z.string().nullish(),
  seo: z
    .object({
      title: z.string().optional(),
      description: z.string().optional(),
      keywords: z.array(z.string()).optional(),
    })
    .nullish(),
  publishedAt: z.string().datetime().nullish(),
});

export async function GET(req: Request): Promise<NextResponse> {
  const pipeline = await runAdminPipeline(req, {
    requireMutation: false,
    permission: 'catalog:write',
  });
  if (!pipeline.ok) return pipeline.response;

  const url = new URL(req.url);
  const cursor = url.searchParams.get('after') ?? undefined;
  const limitRaw = url.searchParams.get('limit');
  const statusRaw = url.searchParams.get('status');
  const status =
    statusRaw && (STATUSES as readonly string[]).includes(statusRaw)
      ? (statusRaw as (typeof STATUSES)[number])
      : undefined;
  const categoryId = url.searchParams.get('categoryId') ?? undefined;
  const brand = url.searchParams.get('brand') ?? undefined;

  try {
    const result = await listProducts(pipeline.storeId, {
      cursor,
      limit: limitRaw ? Number.parseInt(limitRaw, 10) : undefined,
      status,
      categoryId,
      brand,
      includeDeleted: false,
    });
    return NextResponse.json({
      data: result.items,
      page: { nextCursor: result.nextCursor },
    });
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

  const parsedBody = await readJsonBody(req);
  if (!parsedBody.ok) return parsedBody.response;
  const validated = createBody.safeParse(parsedBody.data);
  if (!validated.success) {
    return problem(
      422,
      'invalid-body',
      'Invalid product body',
      validated.error.issues.map(i => ({ path: i.path.map(p => String(p)), message: i.message })),
    );
  }

  try {
    const product = await withIdempotency(
      `admin:catalog:products:create:${pipeline.storeId}`,
      pipeline.idempotencyKey!,
      async () => {
        return createProduct(pipeline.storeId, {
          slug: validated.data.slug,
          name: validated.data.name,
          descriptionMd: validated.data.descriptionMd ?? null,
          brand: validated.data.brand ?? null,
          categoryId: validated.data.categoryId ?? null,
          ...(validated.data.type ? { type: validated.data.type } : {}),
          ...(validated.data.status ? { status: validated.data.status } : {}),
          attributes: validated.data.attributes ?? {},
          taxClass: validated.data.taxClass ?? null,
          seo: validated.data.seo ?? null,
          publishedAt: validated.data.publishedAt ? new Date(validated.data.publishedAt) : null,
        });
      },
    );
    return NextResponse.json({ data: product }, { status: 201 });
  } catch (err) {
    return mapCatalogError(err);
  }
}
