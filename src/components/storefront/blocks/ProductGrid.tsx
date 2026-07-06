import Link from 'next/link';
import type { Route } from 'next';
import { getCategoryBySlug } from '@/modules/catalog/categories';
import { listProducts, getProductById } from '@/modules/catalog/products';
import type { ProductSummary } from '@/modules/catalog/products';
import { loadProductDisplays } from '@/app/(storefront)/_lib/product-pricing';
import { ProductCard } from '@/components/storefront/ProductCard';
import { Reveal, Stagger } from '@/components/storefront/motion';
import type { SiteConfig } from '@/platform.defaults';

export type ProductGridProps = {
  heading?: string;
  collectionSlug?: string;
  productIds?: string[];
  limit: number;
  layout: 'grid' | 'carousel';
};

/**
 * Product-grid block. Sources products either from a category ("collection")
 * slug or an explicit id list, both capped at `limit`. Only active products
 * are shown. The section header pairs the CMS heading with an eyebrow derived
 * from the resolved collection and a sliding-underline "view all" link; cards
 * stagger in on scroll. Carousel layout degrades to a scroll-snap rail.
 */
export async function ProductGrid({
  storeId,
  config,
  heading,
  collectionSlug,
  productIds,
  limit,
  layout,
}: ProductGridProps & { storeId: string; config: SiteConfig }) {
  let products: ProductSummary[] = [];
  let collectionName: string | null = null;

  if (productIds && productIds.length > 0) {
    const resolved = await Promise.all(productIds.slice(0, limit).map(id => getProductById(storeId, id)));
    products = resolved.filter(
      (p): p is ProductSummary => p !== null && p.status === 'active',
    );
  } else if (collectionSlug) {
    const category = await getCategoryBySlug(storeId, collectionSlug);
    if (category) {
      collectionName = category.name;
      const result = await listProducts(storeId, {
        categoryId: category.id,
        status: 'active',
        limit,
      });
      products = result.items;
    }
  }

  if (products.length === 0) return null;
  const displays = await loadProductDisplays(storeId, products);

  const viewAllHref = collectionSlug ? `/c/${collectionSlug}` : '/search';
  const viewAllLabel = collectionName ? `View all ${collectionName.toLowerCase()}` : 'View all';

  return (
    <section className="section hm-plist">
      <div className="wrap-wide">
        <Reveal className="hm-head" y={22}>
          <div>
            <span className="eyebrow">{collectionName ?? 'Handpicked'}</span>
            {heading ? <h2 className="h-lg hm-head-title">{heading}</h2> : null}
          </div>
          <Link className="hm-viewall underline-slide hide-sm" href={viewAllHref as Route}>
            {viewAllLabel} <span aria-hidden>→</span>
          </Link>
        </Reveal>
        <Stagger
          className={layout === 'carousel' ? 'rail hm-rail' : 'pgrid'}
          interval={85}
          y={22}
        >
          {displays.map(display => (
            <ProductCard key={display.product.id} display={display} config={config} />
          ))}
        </Stagger>
      </div>
    </section>
  );
}
