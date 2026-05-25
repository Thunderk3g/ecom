/**
 * GET   /api/v1/admin/customers/[id]   — fetch a customer row
 * PATCH /api/v1/admin/customers/[id]   — partial update (email/phone/locale/segment/...)
 */

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getCustomer, updateCustomer } from '@/modules/customers/customers';
import { problem } from '@/lib/errors';
import { withIdempotency } from '@/lib/idempotency';
import { mapCustomerError, readJsonBody, runAdminPipeline } from '../_lib';

const patchBody = z
  .object({
    email: z.string().email().optional(),
    phone: z.string().min(1).nullable().optional(),
    locale: z.string().min(2).optional(),
    segment: z.string().min(1).nullable().optional(),
    acceptsMarketing: z.boolean().optional(),
    lifetimeValueCents: z.number().int().nonnegative().optional(),
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
    const customer = await getCustomer(pipeline.storeId, id);
    return NextResponse.json({ data: customer });
  } catch (err) {
    return mapCustomerError(err);
  }
}

export async function PATCH(req: Request, ctx: RouteCtx): Promise<NextResponse> {
  const pipeline = await runAdminPipeline(req, {
    requireMutation: true,
    permission: 'customers:write',
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
      'Invalid customer patch',
      validated.error.issues.map(i => ({
        path: i.path.map(p => String(p)),
        message: i.message,
      })),
    );
  }

  try {
    const updated = await withIdempotency(
      `admin:customers:patch:${pipeline.storeId}:${id}`,
      pipeline.idempotencyKey!,
      async () =>
        updateCustomer(pipeline.storeId, id, {
          ...(validated.data.email !== undefined ? { email: validated.data.email } : {}),
          ...(validated.data.phone !== undefined ? { phone: validated.data.phone } : {}),
          ...(validated.data.locale !== undefined ? { locale: validated.data.locale } : {}),
          ...(validated.data.segment !== undefined ? { segment: validated.data.segment } : {}),
          ...(validated.data.acceptsMarketing !== undefined
            ? { acceptsMarketing: validated.data.acceptsMarketing }
            : {}),
          ...(validated.data.lifetimeValueCents !== undefined
            ? { lifetimeValueCents: validated.data.lifetimeValueCents }
            : {}),
        }),
    );
    return NextResponse.json({ data: updated });
  } catch (err) {
    return mapCustomerError(err);
  }
}
