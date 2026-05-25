/**
 * POST /api/v1/admin/inventory/reservations/[id]/release
 *
 * Manual admin release of a stuck reservation. Appends a `release` movement
 * (which the trigger maps to a `reserved` decrement) and flips
 * `stock_reservations.status` to `'released'`. Body is optional: `{ reason? }`.
 *
 * `release()` is idempotent when the reservation is already non-active (the
 * TTL sweep may have raced ahead), so the route just returns 204 in that
 * case as well. ReservationNotFoundError flows through to a 404.
 */

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { release } from '@/modules/inventory/reservations';
import { problem } from '@/lib/errors';
import { withIdempotency } from '@/lib/idempotency';
import { mapInventoryError, readJsonBody, runAdminPipeline } from '../../../_lib';

const releaseBody = z
  .object({
    reason: z.string().min(1).optional(),
  })
  .optional();

type RouteCtx = { params: Promise<{ id: string }> };

export async function POST(req: Request, ctx: RouteCtx): Promise<NextResponse> {
  const pipeline = await runAdminPipeline(req, {
    requireMutation: true,
    permission: 'inventory:write',
  });
  if (!pipeline.ok) return pipeline.response;

  const { id } = await ctx.params;

  // Body is optional — only parse if a body was actually sent.
  let reason: string | undefined;
  const contentLength = req.headers.get('content-length');
  if (contentLength && contentLength !== '0') {
    const parsed = await readJsonBody(req);
    if (!parsed.ok) return parsed.response;
    const validated = releaseBody.safeParse(parsed.data);
    if (!validated.success) {
      return problem(
        422,
        'invalid-body',
        'Invalid release body',
        validated.error.issues.map(i => ({
          path: i.path.map(p => String(p)),
          message: i.message,
        })),
      );
    }
    reason = validated.data?.reason;
  }

  try {
    await withIdempotency(
      `admin:inventory:reservations:release:${pipeline.storeId}:${id}`,
      pipeline.idempotencyKey!,
      async () => {
        if (reason !== undefined) {
          await release(pipeline.storeId, id, reason);
        } else {
          await release(pipeline.storeId, id);
        }
        return { released: true } as const;
      },
    );
    return new NextResponse(null, { status: 204 });
  } catch (err) {
    return mapInventoryError(err);
  }
}
