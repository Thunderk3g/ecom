/**
 * GET  /api/v1/admin/catalog/attributes  — list registered attribute definitions
 * POST /api/v1/admin/catalog/attributes  — define a new attribute
 */

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { listAttributes, defineAttribute } from '@/modules/catalog/attributes';
import { problem } from '@/lib/errors';
import { withIdempotency } from '@/lib/idempotency';
import { mapCatalogError, readJsonBody, runAdminPipeline } from '../_lib';

const createBody = z.object({
  key: z.string().min(1),
  label: z.string().min(1),
  dataType: z.enum(['string', 'number', 'bool', 'enum']),
  unit: z.string().nullish(),
  enumValues: z.array(z.string().min(1)).nullish(),
  filterable: z.boolean().optional(),
  required: z.boolean().optional(),
});

export async function GET(req: Request): Promise<NextResponse> {
  const pipeline = await runAdminPipeline(req, {
    requireMutation: false,
    permission: 'catalog:write',
  });
  if (!pipeline.ok) return pipeline.response;

  const url = new URL(req.url);
  const filterableOnly = url.searchParams.get('filterableOnly') === 'true';

  try {
    const rows = await listAttributes(pipeline.storeId, { filterableOnly });
    return NextResponse.json({ data: rows });
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
      'Invalid attribute body',
      validated.error.issues.map(i => ({ path: i.path.map(p => String(p)), message: i.message })),
    );
  }

  try {
    const row = await withIdempotency(
      `admin:catalog:attributes:create:${pipeline.storeId}`,
      pipeline.idempotencyKey!,
      async () =>
        defineAttribute(pipeline.storeId, {
          key: validated.data.key,
          label: validated.data.label,
          dataType: validated.data.dataType,
          unit: validated.data.unit ?? null,
          enumValues: validated.data.enumValues ?? null,
          ...(validated.data.filterable !== undefined
            ? { filterable: validated.data.filterable }
            : {}),
          ...(validated.data.required !== undefined ? { required: validated.data.required } : {}),
        }),
    );
    return NextResponse.json({ data: row }, { status: 201 });
  } catch (err) {
    return mapCatalogError(err);
  }
}
