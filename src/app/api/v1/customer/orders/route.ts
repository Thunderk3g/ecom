/**
 * Customer order history.
 *
 * GET /api/v1/customer/orders?after=<cursor>&limit=<n>
 *
 * Requires an authenticated customer session (sid cookie). Returns the
 * customer's orders newest-first, cursor-paginated. The cursor + limit
 * conventions follow the shared `lib/cursor.ts` rules (limit clamped to
 * 200; opaque base64url cursor; null nextCursor on the last page).
 *
 * Response shape:
 *   { data: OrderWithItems[], page: { nextCursor: string | null } }
 *
 * Each `OrderWithItems` is the order row plus its `items: order_items[]`.
 */

import { NextResponse } from 'next/server';
import { listCustomerOrders } from '@/modules/checkout/orders';
import { parseLimit } from '@/lib/cursor';
import { problem } from '@/lib/errors';
import { resolveStorefrontContext } from '../../cart/_lib';

export async function GET(req: Request): Promise<NextResponse> {
  const resolved = await resolveStorefrontContext(req);
  if (!resolved.ok) return resolved.response;
  const { ctx: sctx } = resolved;

  if (!sctx.userSession) {
    return problem(401, 'unauthenticated', 'Authentication required', []);
  }

  const url = new URL(req.url);
  const after = url.searchParams.get('after') ?? undefined;
  const limit = parseLimit(url.searchParams.get('limit'));

  const result = await listCustomerOrders(sctx.storeId, sctx.userSession.userId, {
    limit,
    ...(after !== undefined ? { cursor: after } : {}),
  });

  return NextResponse.json({
    data: result.items,
    page: { nextCursor: result.nextCursor },
  });
}
