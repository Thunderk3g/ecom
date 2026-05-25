/**
 * Storefront customer address book.
 *
 *   GET  /api/v1/customer/addresses  — list saved addresses for the caller.
 *   POST /api/v1/customer/addresses  — create a new address (optionally default).
 *
 * Both endpoints scope to the authenticated customer; addresses belonging to
 * other customers are never enumerated. Mutations require CSRF +
 * Idempotency-Key per the global convention.
 */

import { NextResponse } from 'next/server';
import { z } from 'zod';
import {
  createAddress,
  listAddresses,
} from '@/modules/customers/addresses';
import { withIdempotency } from '@/lib/idempotency';
import { problem } from '@/lib/errors';
import {
  mapCustomerError,
  readJsonBody,
  requireMutationGate,
  resolveTenantAndCustomerSession,
} from '../_lib';

export async function GET(req: Request): Promise<NextResponse> {
  const resolved = await resolveTenantAndCustomerSession(req);
  if (!resolved.ok) return resolved.response;
  const { ctx } = resolved;

  try {
    const items = await listAddresses(ctx.storeId, ctx.customer.id);
    return NextResponse.json({ data: items });
  } catch (err) {
    return mapCustomerError(err);
  }
}

const addressTypeSchema = z.enum(['billing', 'shipping', 'both']);

const createBodySchema = z
  .object({
    type: addressTypeSchema,
    name: z.string().min(1),
    line1: z.string().min(1),
    line2: z.string().nullable().optional(),
    city: z.string().min(1),
    region: z.string().min(1),
    postal: z.string().min(1),
    country: z.string().min(2),
    phone: z.string().nullable().optional(),
    isDefault: z.boolean().optional(),
  })
  .strict();

export async function POST(req: Request): Promise<NextResponse> {
  const resolved = await resolveTenantAndCustomerSession(req);
  if (!resolved.ok) return resolved.response;
  const { ctx } = resolved;

  const gate = requireMutationGate(req, ctx);
  if (!gate.ok) return gate.response;

  const parsedBody = await readJsonBody(req);
  if (!parsedBody.ok) return parsedBody.response;
  const validated = createBodySchema.safeParse(parsedBody.data);
  if (!validated.success) {
    return problem(
      400,
      'invalid-body',
      'Invalid request body',
      validated.error.issues.map(i => ({
        path: i.path.map(p => String(p)),
        message: i.message,
      })),
    );
  }
  const body = validated.data;

  try {
    const address = await withIdempotency(
      `storefront:customer:addresses:create:${ctx.storeId}:${ctx.customer.id}`,
      gate.idempotencyKey,
      async () =>
        createAddress(ctx.storeId, ctx.customer.id, {
          type: body.type,
          name: body.name,
          line1: body.line1,
          ...(body.line2 !== undefined ? { line2: body.line2 } : {}),
          city: body.city,
          region: body.region,
          postal: body.postal,
          country: body.country,
          ...(body.phone !== undefined ? { phone: body.phone } : {}),
          ...(body.isDefault !== undefined ? { isDefault: body.isDefault } : {}),
        }),
    );
    return NextResponse.json({ data: address }, { status: 201 });
  } catch (err) {
    return mapCustomerError(err);
  }
}
