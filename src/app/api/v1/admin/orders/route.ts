/**
 * GET /api/v1/admin/orders — cursor-paginated admin order list.
 *
 * Filters (all optional, AND-combined):
 *   - status         single OrderStatus
 *   - paymentStatus  single OrderPaymentStatus
 *   - customerEmail  exact-match (case-sensitive) email lookup
 *   - from           inclusive lower bound on placedAt (ISO timestamp)
 *   - to             inclusive upper bound on placedAt (ISO timestamp)
 *   - after          opaque cursor from a prior page
 *   - limit          page size (clamped to 200)
 */

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { listOrders, type OrderPaymentStatus, type OrderStatus } from '@/modules/orders/lifecycle';
import { problem } from '@/lib/errors';
import { mapOrderError, runAdminPipeline } from './_lib';

const ORDER_STATUSES = [
  'pending_payment',
  'paid',
  'cancelled',
  'fulfilled',
  'refunded',
  'completed',
] as const;

const ORDER_PAYMENT_STATUSES = ['pending', 'paid', 'failed', 'refunded'] as const;

const querySchema = z
  .object({
    status: z.enum(ORDER_STATUSES).optional(),
    paymentStatus: z.enum(ORDER_PAYMENT_STATUSES).optional(),
    customerEmail: z.string().min(1).optional(),
    from: z.string().datetime().optional(),
    to: z.string().datetime().optional(),
    after: z.string().min(1).optional(),
    limit: z.coerce.number().int().min(1).max(200).optional(),
  })
  .strict();

export async function GET(req: Request): Promise<NextResponse> {
  const pipeline = await runAdminPipeline(req, {
    requireMutation: false,
    permission: 'orders:read',
  });
  if (!pipeline.ok) return pipeline.response;

  const url = new URL(req.url);
  const rawQuery: Record<string, string> = {};
  for (const [k, v] of url.searchParams.entries()) {
    rawQuery[k] = v;
  }
  const validated = querySchema.safeParse(rawQuery);
  if (!validated.success) {
    return problem(
      422,
      'invalid-query',
      'Invalid orders list query',
      validated.error.issues.map(i => ({
        path: i.path.map(p => String(p)),
        message: i.message,
      })),
    );
  }

  const opts: Parameters<typeof listOrders>[1] = {};
  if (validated.data.status !== undefined) {
    opts.status = validated.data.status as OrderStatus;
  }
  if (validated.data.paymentStatus !== undefined) {
    opts.paymentStatus = validated.data.paymentStatus as OrderPaymentStatus;
  }
  if (validated.data.customerEmail !== undefined) {
    opts.customerEmail = validated.data.customerEmail;
  }
  if (validated.data.from !== undefined) {
    opts.from = new Date(validated.data.from);
  }
  if (validated.data.to !== undefined) {
    opts.to = new Date(validated.data.to);
  }
  if (validated.data.after !== undefined) {
    opts.cursor = validated.data.after;
  }
  if (validated.data.limit !== undefined) {
    opts.limit = validated.data.limit;
  }

  try {
    const result = await listOrders(pipeline.storeId, opts);
    return NextResponse.json({
      data: result.items,
      page: { nextCursor: result.nextCursor },
    });
  } catch (err) {
    return mapOrderError(err);
  }
}
