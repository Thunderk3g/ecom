/**
 * POST /api/v1/admin/inventory/levels/adjust
 *
 * Records an `adjustment` movement (signed `delta`) against
 * `(variantId, locationId)`. The 0010 trigger materializes the new on_hand.
 * The `reason` is required for audit (e.g. 'shrinkage', 'recount').
 */

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { adjustStock } from '@/modules/inventory/movements';
import { problem } from '@/lib/errors';
import { withIdempotency } from '@/lib/idempotency';
import { mapInventoryError, readJsonBody, runAdminPipeline } from '../../_lib';

const adjustBody = z.object({
  variantId: z.string().uuid(),
  locationId: z.string().uuid(),
  delta: z.number().int(),
  reason: z.string().min(1),
});

export async function POST(req: Request): Promise<NextResponse> {
  const pipeline = await runAdminPipeline(req, {
    requireMutation: true,
    permission: 'inventory:write',
  });
  if (!pipeline.ok) return pipeline.response;

  const parsed = await readJsonBody(req);
  if (!parsed.ok) return parsed.response;
  const validated = adjustBody.safeParse(parsed.data);
  if (!validated.success) {
    return problem(
      422,
      'invalid-body',
      'Invalid adjust body',
      validated.error.issues.map(i => ({ path: i.path.map(p => String(p)), message: i.message })),
    );
  }

  try {
    await withIdempotency(
      `admin:inventory:levels:adjust:${pipeline.storeId}`,
      pipeline.idempotencyKey!,
      async () => {
        await adjustStock(pipeline.storeId, {
          variantId: validated.data.variantId,
          locationId: validated.data.locationId,
          delta: validated.data.delta,
          reason: validated.data.reason,
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
