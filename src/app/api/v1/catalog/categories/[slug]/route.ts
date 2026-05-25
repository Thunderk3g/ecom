/**
 * Storefront catalog: single category lookup by slug.
 *
 * GET /api/v1/catalog/categories/:slug
 *
 * Returns the category row when present in the resolved tenant scope.
 * RFC 7807 404 when the slug is unknown.
 */

import { NextResponse } from 'next/server';
import { resolveTenant } from '@/modules/tenant/resolve';
import { getCategoryBySlug } from '@/modules/catalog/categories';
import { problem } from '@/lib/errors';

type Params = { slug: string };

export async function GET(
  req: Request,
  ctx: { params: Promise<Params> },
): Promise<NextResponse> {
  const host = req.headers.get('x-store-host') ?? req.headers.get('host') ?? '';
  const storeId = host ? await resolveTenant(host) : null;
  if (!storeId) {
    return problem(404, 'tenant-not-found', 'Unknown host', []);
  }

  const { slug } = await ctx.params;
  if (!slug) {
    return problem(400, 'invalid-path', 'slug is required', [
      { path: ['slug'], message: 'required' },
    ]);
  }

  const category = await getCategoryBySlug(storeId, slug);
  if (!category) {
    return problem(404, 'category-not-found', `Category not found: ${slug}`, [
      { path: ['slug'], message: 'not found' },
    ]);
  }

  return NextResponse.json({ data: category });
}
