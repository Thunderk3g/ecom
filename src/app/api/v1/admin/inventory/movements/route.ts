/**
 * GET /api/v1/admin/inventory/movements
 *
 * Cursor-paginated view of the append-only `stock_movements` ledger.
 * Filters: `variantId`, `locationId`, `kind`, `from`, `to`.
 */

import { NextResponse } from 'next/server';
import { listMovements, type MovementKind } from '@/modules/inventory/movements';
import { mapInventoryError, runAdminPipeline } from '../_lib';

const MOVEMENT_KINDS: readonly MovementKind[] = [
  'inbound',
  'outbound',
  'adjustment',
  'reservation',
  'release',
  'transfer_out',
  'transfer_in',
];

function parseDate(s: string | null): Date | undefined {
  if (!s) return undefined;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? undefined : d;
}

export async function GET(req: Request): Promise<NextResponse> {
  const pipeline = await runAdminPipeline(req, {
    requireMutation: false,
    permission: 'inventory:read',
  });
  if (!pipeline.ok) return pipeline.response;

  const url = new URL(req.url);
  const cursor = url.searchParams.get('after') ?? undefined;
  const limitRaw = url.searchParams.get('limit');
  const variantId = url.searchParams.get('variantId') ?? undefined;
  const locationId = url.searchParams.get('locationId') ?? undefined;
  const kindRaw = url.searchParams.get('kind');
  const kind =
    kindRaw && (MOVEMENT_KINDS as readonly string[]).includes(kindRaw)
      ? (kindRaw as MovementKind)
      : undefined;
  const from = parseDate(url.searchParams.get('from'));
  const to = parseDate(url.searchParams.get('to'));

  try {
    const result = await listMovements(pipeline.storeId, {
      ...(cursor !== undefined ? { cursor } : {}),
      ...(limitRaw ? { limit: Number.parseInt(limitRaw, 10) } : {}),
      ...(variantId !== undefined ? { variantId } : {}),
      ...(locationId !== undefined ? { locationId } : {}),
      ...(kind !== undefined ? { kind } : {}),
      ...(from !== undefined ? { from } : {}),
      ...(to !== undefined ? { to } : {}),
    });
    return NextResponse.json({
      data: result.items,
      page: { nextCursor: result.nextCursor },
    });
  } catch (err) {
    return mapInventoryError(err);
  }
}
