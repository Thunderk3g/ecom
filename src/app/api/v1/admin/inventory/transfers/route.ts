/**
 * POST /api/v1/admin/inventory/transfers
 *
 * Atomically moves `qty` of a variant between two locations. Emits one
 * `transfer_out` and one `transfer_in` movement in a single transaction so
 * the level deltas are inseparable.
 */

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { transfer } from '@/modules/inventory/movements';
import { problem } from '@/lib/errors';
import { withIdempotency } from '@/lib/idempotency';
import { mapInventoryError, readJsonBody, runAdminPipeline } from '../_lib';

const transferBody = z.object({
  variantId: z.string().uuid(),
  fromLocationId: z.string().uuid(),
  toLocationId: z.string().uuid(),
  qty: z.number().int().positive(),
  reason: z.string().min(1).optional(),
});

export async function POST(req: Request): Promise<NextResponse> {
  const pipeline = await runAdminPipeline(req, {
    requireMutation: true,
    permission: 'inventory:write',
  });
  if (!pipeline.ok) return pipeline.response;

  const parsed = await readJsonBody(req);
  if (!parsed.ok) return parsed.response;
  const validated = transferBody.safeParse(parsed.data);
  if (!validated.success) {
    return problem(
      422,
      'invalid-body',
      'Invalid transfer body',
      validated.error.issues.map(i => ({ path: i.path.map(p => String(p)), message: i.message })),
    );
  }

  try {
    await withIdempotency(
      `admin:inventory:transfers:${pipeline.storeId}`,
      pipeline.idempotencyKey!,
      async () => {
        await transfer(pipeline.storeId, {
          variantId: validated.data.variantId,
          fromLocationId: validated.data.fromLocationId,
          toLocationId: validated.data.toLocationId,
          qty: validated.data.qty,
          ...(validated.data.reason !== undefined ? { reason: validated.data.reason } : {}),
          createdBy: pipeline.session.userId,
        });
        return { ok: true } as const;
      },
    );
    return NextResponse.json({ data: { ok: true } });
  } catch (err) {
    return mapInventoryError(err);
  }
}
