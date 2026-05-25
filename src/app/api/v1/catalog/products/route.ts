/**
 * Storefront catalog: product listing + facets.
 *
 * GET /api/v1/catalog/products
 *
 * Query parameters:
 *   - after        — opaque cursor (from a previous response's nextCursor)
 *   - limit        — page size; clamped to MAX_LIMIT in parseLimit (default 50)
 *   - category     — category id (uuid) to filter by
 *   - brand        — exact brand string to filter by
 *   - attr.<key>   — attribute filter; key is the attribute key registered in
 *                    attribute_definitions. Repeated keys collapse to an "IN"
 *                    filter (e.g. ?attr.color=red&attr.color=blue).
 *
 * Response:
 *   { data: ProductSummary[], page: { nextCursor }, facets }
 *
 * Storefront listings always exclude soft-deleted rows and only surface
 * products in `active` status (admin endpoints — Stream D — see drafts).
 */

import { NextResponse } from 'next/server';
import { resolveTenant } from '@/modules/tenant/resolve';
import { listProducts, type ListProductsOptions } from '@/modules/catalog/products';
import { computeFacets } from '@/modules/catalog/facets';
import { parseLimit } from '@/lib/cursor';
import { problem } from '@/lib/errors';

export async function GET(req: Request): Promise<NextResponse> {
  const host = req.headers.get('x-store-host') ?? req.headers.get('host') ?? '';
  const storeId = host ? await resolveTenant(host) : null;
  if (!storeId) {
    return problem(404, 'tenant-not-found', 'Unknown host', []);
  }

  const url = new URL(req.url);
  const params = url.searchParams;

  const after = params.get('after') ?? undefined;
  const limit = parseLimit(params.get('limit'));
  const category = params.get('category') ?? undefined;
  const brand = params.get('brand') ?? undefined;

  // Collect attr.<key>=<value> filters; repeated keys become an array.
  const attrs: Record<string, string | string[]> = {};
  for (const [rawKey, rawValue] of params.entries()) {
    if (!rawKey.startsWith('attr.')) continue;
    const key = rawKey.slice('attr.'.length);
    if (key === '') continue;
    const existing = attrs[key];
    if (existing === undefined) {
      attrs[key] = rawValue;
    } else if (Array.isArray(existing)) {
      existing.push(rawValue);
    } else {
      attrs[key] = [existing, rawValue];
    }
  }

  const opts: ListProductsOptions = {
    status: 'active',
    limit,
    ...(after !== undefined ? { cursor: after } : {}),
    ...(category !== undefined ? { categoryId: category } : {}),
    ...(brand !== undefined ? { brand } : {}),
    ...(Object.keys(attrs).length > 0 ? { attrs } : {}),
  };

  const [{ items, nextCursor }, facets] = await Promise.all([
    listProducts(storeId, opts),
    computeFacets(storeId, {
      status: 'active',
      ...(category !== undefined ? { categoryId: category } : {}),
      ...(brand !== undefined ? { brand } : {}),
      ...(Object.keys(attrs).length > 0 ? { attrs } : {}),
    }),
  ]);

  return NextResponse.json({
    data: items,
    page: { nextCursor },
    facets,
  });
}
