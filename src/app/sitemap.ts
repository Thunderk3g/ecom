import type { MetadataRoute } from 'next';
import { headers } from 'next/headers';
import { resolveTenant } from '@/modules/tenant/resolve';
import { withTenant } from '@/modules/tenant/with-tenant';
import { listPages } from '@/modules/cms/pages';
import { listProducts } from '@/modules/catalog/products';
import { categories } from '@/db/schema/catalog';
import { eq } from 'drizzle-orm';

/**
 * Storefront sitemap. Emits one entry for the homepage, plus every published
 * CMS marketing page, published category, and active product for the tenant
 * identified by the request host. An unknown host returns an empty sitemap
 * rather than 404 — crawlers should never see a hard error here.
 *
 * Hard-capped at 5000 products to stay under Next's sitemap entry limit
 * (50k per sitemap; we'll add a sitemap index in a follow-up).
 *
 * Cache the result for an hour to keep DB hits bounded on aggressive crawls.
 * Published mutations regenerate via on-publish revalidation (Task 21).
 */
export const revalidate = 3600;

const PRODUCT_CAP = 5000;
// TODO(SP-7 follow-up): paginate beyond PRODUCT_CAP via /sitemap-products-N.xml.

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const h = await headers();
  const host = h.get('x-store-host') ?? h.get('host') ?? '';
  const storeId = host ? await resolveTenant(host) : null;
  if (!storeId) return [];

  // Storefront URLs are host-relative (no protocol/host) so Next renders them
  // as absolute against the current request URL. This avoids embedding a
  // wrong host when a tenant is reachable on multiple domains.
  const origin = deriveOrigin(host);

  const [pages, productResult, publishedCategories] = await Promise.all([
    listPages(storeId, { status: 'published' }),
    listProducts(storeId, { status: 'active', limit: PRODUCT_CAP }),
    withTenant(storeId, async tx =>
      tx.select().from(categories).where(eq(categories.published, true)),
    ),
  ]);

  const now = new Date();
  const entries: MetadataRoute.Sitemap = [];

  entries.push({
    url: `${origin}/`,
    lastModified: now,
    changeFrequency: 'daily',
    priority: 1,
  });

  for (const page of pages) {
    entries.push({
      url: `${origin}/pages/${page.slug}`,
      lastModified: page.updatedAt,
      changeFrequency: 'weekly',
      priority: 0.6,
    });
  }

  for (const category of publishedCategories) {
    entries.push({
      url: `${origin}/c/${category.slug}`,
      lastModified: category.updatedAt,
      changeFrequency: 'daily',
      priority: 0.7,
    });
  }

  for (const product of productResult.items) {
    entries.push({
      url: `${origin}/p/${product.slug}`,
      lastModified: product.updatedAt,
      changeFrequency: 'weekly',
      priority: 0.5,
    });
  }

  return entries;
}

/**
 * Best-effort scheme + host for absolute URLs. We prefer the forwarded host
 * the storefront middleware stamps (`x-store-host`); falling back to the raw
 * `host` header. Local dev hosts default to http; everything else https.
 */
function deriveOrigin(host: string): string {
  const lower = host.toLowerCase();
  const isLocal = lower.startsWith('localhost') || lower.startsWith('127.0.0.1');
  const scheme = isLocal ? 'http' : 'https';
  return `${scheme}://${host}`;
}
