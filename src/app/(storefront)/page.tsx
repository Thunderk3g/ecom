import Link from 'next/link';
import { getPageBySlug } from '@/modules/cms/pages';
import { listProducts } from '@/modules/catalog/products';
import { getCategoryTree } from '@/modules/catalog/categories';
import { Button } from '@/components/ui/button';
import { CmsBlockRenderer } from '@/components/storefront/CmsBlockRenderer';
import { ProductCard } from '@/components/storefront/ProductCard';
import { getStoreContext } from './_lib/context';
import { loadProductDisplays } from './_lib/product-pricing';

// Storefront content is per-tenant and frequently updated; render dynamically
// so tenant resolution + published CMS state are always current.
export const dynamic = 'force-dynamic';

/**
 * Storefront home. Renders the published `home` CMS page through the block
 * registry. When no home page is published, falls back to a sensible default:
 * a hero plus the newest active products and category links.
 */
export default async function Home() {
  const { storeId, config } = await getStoreContext();
  const page = await getPageBySlug(storeId, 'home');

  if (page && page.blocks.length > 0) {
    return <CmsBlockRenderer storeId={storeId} config={config} blocks={page.blocks} />;
  }

  // Default homepage (no published CMS page yet).
  const [{ items }, categories] = await Promise.all([
    listProducts(storeId, { status: 'active', limit: 8 }),
    getCategoryTree(storeId),
  ]);
  const displays = await loadProductDisplays(storeId, items);

  return (
    <>
      <section className="border-b bg-brand/5">
        <div className="container flex flex-col items-start gap-4 py-20 md:py-28">
          <h1 className="max-w-2xl font-serif text-4xl font-semibold tracking-tight text-brand md:text-5xl">
            {config.brand.name}
          </h1>
          {config.brand.tagline ? (
            <p className="max-w-xl text-lg text-muted-foreground">{config.brand.tagline}</p>
          ) : null}
          <Button asChild size="lg" className="mt-2">
            <Link href="/search">Browse the shop</Link>
          </Button>
        </div>
      </section>

      {categories.length > 0 ? (
        <section className="container py-12">
          <h2 className="mb-6 font-serif text-2xl font-semibold tracking-tight">Shop by category</h2>
          <div className="flex flex-wrap gap-2">
            {categories.map(cat => (
              <Button key={cat.id} asChild variant="outline" size="sm">
                <Link href={`/c/${cat.slug}`}>{cat.name}</Link>
              </Button>
            ))}
          </div>
        </section>
      ) : null}

      {displays.length > 0 ? (
        <section className="container py-12">
          <h2 className="mb-6 font-serif text-2xl font-semibold tracking-tight">New arrivals</h2>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
            {displays.map(display => (
              <ProductCard key={display.product.id} display={display} config={config} />
            ))}
          </div>
        </section>
      ) : (
        <section className="container py-16 text-center text-muted-foreground">
          Our catalog is being stocked. Check back soon.
        </section>
      )}
    </>
  );
}
