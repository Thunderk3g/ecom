/**
 * Storefront catalog: product detail by slug.
 *
 * GET /api/v1/catalog/products/:slug
 *
 * Returns the product row joined with its variants (ordered by createdAt asc)
 * and images (ordered by sortOrder asc). Soft-deleted products are treated as
 * missing — RFC 7807 404.
 */

import { NextResponse } from 'next/server';
import { resolveTenant } from '@/modules/tenant/resolve';
import { getProductBySlug } from '@/modules/catalog/products';
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

  const product = await getProductBySlug(storeId, slug);
  if (!product) {
    return problem(404, 'product-not-found', `Product not found: ${slug}`, [
      { path: ['slug'], message: 'not found' },
    ]);
  }

  return NextResponse.json({ data: product });
}
