/**
 * Storefront catalog: category tree.
 *
 * GET /api/v1/catalog/categories
 *
 * Returns the published category tree for the resolved tenant. The tree is
 * an array of root nodes; each node carries its own row plus a `children`
 * array (nested recursively). Unpublished categories are excluded.
 */

import { NextResponse } from 'next/server';
import { resolveTenant } from '@/modules/tenant/resolve';
import { getCategoryTree } from '@/modules/catalog/categories';
import { problem } from '@/lib/errors';

export async function GET(req: Request): Promise<NextResponse> {
  const host = req.headers.get('x-store-host') ?? req.headers.get('host') ?? '';
  const storeId = host ? await resolveTenant(host) : null;
  if (!storeId) {
    return problem(404, 'tenant-not-found', 'Unknown host', []);
  }

  const tree = await getCategoryTree(storeId);
  return NextResponse.json({ data: tree });
}
