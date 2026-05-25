/**
 * Storefront catalog: search + typeahead.
 *
 * GET /api/v1/catalog/search?q=<query>&after=<cursor>&limit=<n>
 *   — full-text + trigram search over the resolved tenant's products.
 *
 * GET /api/v1/catalog/search?q=<query>&suggest=1
 *   — typeahead suggestions (limit clamped to 50 inside the module service).
 *
 * Response shape:
 *   suggest mode → { data: Suggestion[] }
 *   search mode  → { data: ProductSummary[], page: { nextCursor } }
 *
 * `q` is required. Missing/blank `q` returns 400 RFC 7807.
 */

import { NextResponse } from 'next/server';
import { resolveTenant } from '@/modules/tenant/resolve';
import { searchProducts, suggest } from '@/modules/catalog/search';
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
  const q = params.get('q')?.trim() ?? '';
  if (q === '') {
    return problem(400, 'invalid-query', 'q is required', [
      { path: ['q'], message: 'required' },
    ]);
  }

  const suggestMode = params.get('suggest') === '1' || params.get('suggest') === 'true';

  if (suggestMode) {
    const limit = parseLimit(params.get('limit'), 8, 50);
    const items = await suggest(storeId, q, limit);
    return NextResponse.json({ data: items });
  }

  const after = params.get('after') ?? undefined;
  const limit = parseLimit(params.get('limit'));
  const { items, nextCursor } = await searchProducts(storeId, q, {
    limit,
    ...(after !== undefined ? { cursor: after } : {}),
    filters: { status: 'active' },
  });

  return NextResponse.json({
    data: items,
    page: { nextCursor },
  });
}
