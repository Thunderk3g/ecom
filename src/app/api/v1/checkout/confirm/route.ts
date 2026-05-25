/**
 * Storefront checkout: advisory confirm.
 *
 * POST /api/v1/checkout/confirm
 * Body: `{ intentId: string (uuid) }`
 *
 * Optional client-side success callback. The payment webhook (Stream F) is
 * the source of truth — this endpoint just lets the client poll for the
 * resulting order number after the provider's redirect/return URL fires.
 *
 *   - Intent has succeeded: returns 200 `{ data: { orderNumber } }`.
 *   - Intent still pending: returns 202 `{ pending: true, status }`.
 *   - Intent not found:     404 (IntentNotFoundError).
 *
 * Gates: Idempotency-Key + CSRF. This is technically a read but it is a
 * POST per the plan and may carry side effects in future revisions (e.g.
 * forcing a provider-side status pull) — gated like any other mutation.
 */

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { confirmCheckoutAdvisory } from '@/modules/checkout/checkout';
import { withRateLimit } from '@/lib/rate-limit';
import { problem } from '@/lib/errors';
import {
  readJsonBody,
  requireMutationGate,
  resolveStorefrontContext,
  attachCartSidCookie,
} from '../../cart/_lib';
import { mapCheckoutError } from '../_lib';

const bodySchema = z
  .object({
    intentId: z.string().uuid(),
  })
  .strict();

export async function POST(req: Request): Promise<NextResponse> {
  // Per-IP rate limit: 20/min. Confirm is polled after a provider redirect,
  // so the upper bound is "a hard-loop polling client" — 20/min is plenty.
  const limited = await withRateLimit(req, { limit: 20, windowSeconds: 60 });
  if (limited) return limited;

  const resolved = await resolveStorefrontContext(req);
  if (!resolved.ok) return resolved.response;
  const { ctx: sctx } = resolved;

  const gate = requireMutationGate(req, sctx);
  if (!gate.ok) return gate.response;

  const parsedBody = await readJsonBody(req);
  if (!parsedBody.ok) return parsedBody.response;
  const validated = bodySchema.safeParse(parsedBody.data);
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
    const result = await confirmCheckoutAdvisory(sctx.storeId, body.intentId);

    if (result.status !== 'succeeded' || !result.orderNumber) {
      return attachCartSidCookie(
        NextResponse.json(
          { pending: true, status: result.status },
          { status: 202 },
        ),
        sctx,
      );
    }
    return attachCartSidCookie(
      NextResponse.json({ data: { orderNumber: result.orderNumber } }),
      sctx,
    );
  } catch (err) {
    return mapCheckoutError(err);
  }
}
