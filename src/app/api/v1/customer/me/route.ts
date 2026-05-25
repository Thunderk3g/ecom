/**
 * Storefront customer profile.
 *
 *   GET   /api/v1/customer/me   — return the logged-in customer record.
 *   PATCH /api/v1/customer/me   — update phone / locale / acceptsMarketing.
 *
 * Email is intentionally NOT patchable here — it is part of identity (shared
 * `users` row + per-store `customers` row) and changing it has merge
 * implications (guest collisions, prior orders). Email changes go through a
 * dedicated identity flow not in SP-5 scope.
 *
 * Gates on PATCH: CSRF (against the user-session id) + Idempotency-Key.
 */

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { updateCustomer } from '@/modules/customers/customers';
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

  return NextResponse.json({ data: resolved.ctx.customer });
}

const patchSchema = z
  .object({
    phone: z.string().min(1).nullable().optional(),
    locale: z.string().min(2).optional(),
    acceptsMarketing: z.boolean().optional(),
  })
  .strict()
  .refine(
    v =>
      v.phone !== undefined ||
      v.locale !== undefined ||
      v.acceptsMarketing !== undefined,
    {
      message: 'At least one of phone, locale, acceptsMarketing is required',
      path: ['phone'],
    },
  );

export async function PATCH(req: Request): Promise<NextResponse> {
  const resolved = await resolveTenantAndCustomerSession(req);
  if (!resolved.ok) return resolved.response;
  const { ctx } = resolved;

  const gate = requireMutationGate(req, ctx);
  if (!gate.ok) return gate.response;

  const parsedBody = await readJsonBody(req);
  if (!parsedBody.ok) return parsedBody.response;
  const validated = patchSchema.safeParse(parsedBody.data);
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
    const customer = await withIdempotency(
      `storefront:customer:me:${ctx.storeId}:${ctx.customer.id}`,
      gate.idempotencyKey,
      async () =>
        updateCustomer(ctx.storeId, ctx.customer.id, {
          ...(body.phone !== undefined ? { phone: body.phone } : {}),
          ...(body.locale !== undefined ? { locale: body.locale } : {}),
          ...(body.acceptsMarketing !== undefined
            ? { acceptsMarketing: body.acceptsMarketing }
            : {}),
        }),
    );
    return NextResponse.json({ data: customer });
  } catch (err) {
    return mapCustomerError(err);
  }
}
