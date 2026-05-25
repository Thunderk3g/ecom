/**
 * GET  /api/v1/admin/customers/[id]/addresses — list saved addresses
 * POST /api/v1/admin/customers/[id]/addresses — create address (optionally default)
 */

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createAddress, listAddresses } from '@/modules/customers/addresses';
import { problem } from '@/lib/errors';
import { withIdempotency } from '@/lib/idempotency';
import { mapCustomerError, readJsonBody, runAdminPipeline } from '../../_lib';

const ADDRESS_TYPES = ['billing', 'shipping', 'both'] as const;

const createBody = z
  .object({
    type: z.enum(ADDRESS_TYPES),
    name: z.string().min(1),
    line1: z.string().min(1),
    line2: z.string().min(1).nullable().optional(),
    city: z.string().min(1),
    region: z.string().min(1),
    postal: z.string().min(1),
    country: z.string().min(2),
    phone: z.string().min(1).nullable().optional(),
    isDefault: z.boolean().optional(),
  })
  .strict();

type RouteCtx = { params: Promise<{ id: string }> };

export async function GET(req: Request, ctx: RouteCtx): Promise<NextResponse> {
  const pipeline = await runAdminPipeline(req, {
    requireMutation: false,
    permission: 'customers:read',
  });
  if (!pipeline.ok) return pipeline.response;

  const { id } = await ctx.params;
  try {
    const rows = await listAddresses(pipeline.storeId, id);
    return NextResponse.json({ data: rows });
  } catch (err) {
    return mapCustomerError(err);
  }
}

export async function POST(req: Request, ctx: RouteCtx): Promise<NextResponse> {
  const pipeline = await runAdminPipeline(req, {
    requireMutation: true,
    permission: 'customers:write',
  });
  if (!pipeline.ok) return pipeline.response;

  const { id } = await ctx.params;
  const parsed = await readJsonBody(req);
  if (!parsed.ok) return parsed.response;
  const validated = createBody.safeParse(parsed.data);
  if (!validated.success) {
    return problem(
      422,
      'invalid-body',
      'Invalid address body',
      validated.error.issues.map(i => ({
        path: i.path.map(p => String(p)),
        message: i.message,
      })),
    );
  }

  try {
    const address = await withIdempotency(
      `admin:customers:addresses:create:${pipeline.storeId}:${id}`,
      pipeline.idempotencyKey!,
      async () =>
        createAddress(pipeline.storeId, id, {
          type: validated.data.type,
          name: validated.data.name,
          line1: validated.data.line1,
          ...(validated.data.line2 !== undefined ? { line2: validated.data.line2 } : {}),
          city: validated.data.city,
          region: validated.data.region,
          postal: validated.data.postal,
          country: validated.data.country,
          ...(validated.data.phone !== undefined ? { phone: validated.data.phone } : {}),
          ...(validated.data.isDefault !== undefined
            ? { isDefault: validated.data.isDefault }
            : {}),
        }),
    );
    return NextResponse.json({ data: address }, { status: 201 });
  } catch (err) {
    return mapCustomerError(err);
  }
}
