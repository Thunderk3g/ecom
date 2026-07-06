import Link from 'next/link';
import { getPageBySlug } from '@/modules/cms/pages';
import { listProducts } from '@/modules/catalog/products';
import { getCategoryTree } from '@/modules/catalog/categories';
import { CmsBlockRenderer } from '@/components/storefront/CmsBlockRenderer';
import { Hero } from '@/components/storefront/blocks/Hero';
import { CategoryTiles } from '@/components/storefront/blocks/CategoryTiles';
import { Newsletter } from '@/components/storefront/blocks/Newsletter';
import { ProductCard } from '@/components/storefront/ProductCard';
import { Reveal, Stagger } from '@/components/storefront/motion';
import { getStoreContext } from './_lib/context';
import { loadProductDisplays } from './_lib/product-pricing';

// Storefront content is per-tenant and frequently updated; render dynamically
// so tenant resolution + published CMS state are always current.
export const dynamic = 'force-dynamic';

/**
 * Storefront home. Renders the published `home` CMS page through the block
 * registry. When no home page is published, falls back to the same editorial
 * treatment built from the shared block pieces: parallax hero with department
 * chips, the asymmetric category mosaic, a staggered new-arrivals grid and
 * the newsletter band.
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
      <Hero
        storeId={storeId}
        config={config}
        title={'Things worth\nwriting down.'}
        subtitle={config.brand.tagline}
        cta={{ label: 'Browse the shop', href: '/search' }}
      />

      {categories.length > 0 ? (
        <section className="section hm-cats-sec">
          <div className="wrap-wide">
            <CategoryTiles
              eyebrow="Departments"
              heading="Shop by department"
              tiles={categories.map(cat => ({
                id: cat.id,
                slug: cat.slug,
                name: cat.name,
                description: cat.description,
                childNames: cat.children.map(child => child.name),
              }))}
            />
          </div>
        </section>
      ) : null}

      {displays.length > 0 ? (
        <section className="section hm-plist">
          <div className="wrap-wide">
            <Reveal className="hm-head" y={22}>
              <div>
                <span className="eyebrow">Just in</span>
                <h2 className="h-lg hm-head-title">New arrivals</h2>
              </div>
              <Link className="hm-viewall underline-slide hide-sm" href="/search">
                Shop the collection <span aria-hidden>→</span>
              </Link>
            </Reveal>
            <Stagger className="pgrid" interval={85} y={22}>
              {displays.map(display => (
                <ProductCard key={display.product.id} display={display} config={config} />
              ))}
            </Stagger>
          </div>
        </section>
      ) : (
        <section className="section">
          <div className="wrap-wide center" style={{ color: 'var(--ink-3)' }}>
            Our catalog is being stocked. Check back soon.
          </div>
        </section>
      )}

      <Newsletter />
    </>
  );
}
