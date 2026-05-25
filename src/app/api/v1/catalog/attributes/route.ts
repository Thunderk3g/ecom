/**
 * Storefront catalog: attribute registry.
 *
 * GET /api/v1/catalog/attributes
 *   — returns every registered attribute definition for the resolved tenant.
 *
 * GET /api/v1/catalog/attributes?filterableOnly=true
 *   — narrows the list to attributes marked `filterable = true`, used by the
 *     storefront filter sidebar.
 */

import { NextResponse } from 'next/server';
import { resolveTenant } from '@/modules/tenant/resolve';
import { listAttributes } from '@/modules/catalog/attributes';
import { problem } from '@/lib/errors';

export async function GET(req: Request): Promise<NextResponse> {
  const host = req.headers.get('x-store-host') ?? req.headers.get('host') ?? '';
  const storeId = host ? await resolveTenant(host) : null;
  if (!storeId) {
    return problem(404, 'tenant-not-found', 'Unknown host', []);
  }

  const url = new URL(req.url);
  const flag = url.searchParams.get('filterableOnly');
  const filterableOnly = flag === 'true' || flag === '1';

  const items = await listAttributes(storeId, { filterableOnly });
  return NextResponse.json({ data: items });
}
