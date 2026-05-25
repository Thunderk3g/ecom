import { getCategoryBySlug } from '@/modules/catalog/categories';
import { listProducts, getProductById } from '@/modules/catalog/products';
import type { ProductSummary } from '@/modules/catalog/products';
import { loadProductDisplays } from '@/app/(storefront)/_lib/product-pricing';
import { ProductCard } from '@/components/storefront/ProductCard';
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
 * slug or an explicit id list, both capped at `limit`. Only active products are
 * shown. Carousel layout degrades to a horizontally scrollable row.
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

  if (productIds && productIds.length > 0) {
    const resolved = await Promise.all(productIds.slice(0, limit).map(id => getProductById(storeId, id)));
    products = resolved.filter(
      (p): p is ProductSummary => p !== null && p.status === 'active',
    );
  } else if (collectionSlug) {
    const category = await getCategoryBySlug(storeId, collectionSlug);
    if (category) {
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

  return (
    <section className="container py-12">
      {heading ? (
        <h2 className="mb-6 font-serif text-2xl font-semibold tracking-tight">{heading}</h2>
      ) : null}
      <div
        className={
          layout === 'carousel'
            ? 'flex snap-x gap-4 overflow-x-auto pb-2 [&>*]:w-56 [&>*]:shrink-0 [&>*]:snap-start'
            : 'grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4'
        }
      >
        {displays.map(display => (
          <ProductCard key={display.product.id} display={display} config={config} />
        ))}
      </div>
    </section>
  );
}
