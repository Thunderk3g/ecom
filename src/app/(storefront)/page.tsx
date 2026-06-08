import Link from 'next/link';
import { getPageBySlug } from '@/modules/cms/pages';
import { listProducts } from '@/modules/catalog/products';
import { getCategoryTree } from '@/modules/catalog/categories';
import { CmsBlockRenderer } from '@/components/storefront/CmsBlockRenderer';
import { formatMoney } from './_lib/money';
import { getStoreContext } from './_lib/context';
import { loadProductDisplays } from './_lib/product-pricing';
import { getProductImage, getCategoryImage } from '@/utils/storefront-assets';

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
      {/* HERO */}
      <section className="hero-wrap">
        <div className="wrap-wide">
          <div className="hero">
            <div className="hero-copy">
              <span className="eyebrow">{config.brand.name}</span>
              <h1 className="display">
                Things worth
                <br />
                <em>writing</em> down.
              </h1>
              {config.brand.tagline ? (
                <p className="lede" style={{ maxWidth: '42ch', marginTop: 8 }}>
                  {config.brand.tagline}
                </p>
              ) : null}
              <div
                className="row"
                style={{ gap: 12, marginTop: 30, flexWrap: 'wrap' }}
              >
                <Link className="btn btn-clay btn-lg" href="/search">
                  Browse the shop <span className="arr">→</span>
                </Link>
              </div>
              {categories.length > 0 ? (
                <div className="hero-cats">
                  {categories.map(cat => (
                    <Link key={cat.id} href={`/c/${cat.slug}`} className="chip">
                      {cat.name}
                    </Link>
                  ))}
                </div>
              ) : null}
            </div>
            <div className="hero-art">
              <img
                src="/images/hero.png"
                alt="Fine stationery — notebooks, pens & desk goods"
                style={{ aspectRatio: '4/5', borderRadius: 'var(--r-lg)', objectFit: 'cover', width: '100%', height: '100%' }}
              />
            </div>
          </div>
        </div>
      </section>

      {/* NEW ARRIVALS */}
      {displays.length > 0 ? (
        <section className="section" style={{ paddingTop: 'clamp(40px,5vw,72px)' }}>
          <div className="wrap-wide">
            <div
              className="between"
              style={{ marginBottom: 26, alignItems: 'flex-end' }}
            >
              <div>
                <span className="eyebrow">Most wanted</span>
                <h2 className="h-lg" style={{ marginTop: 8 }}>
                  New arrivals
                </h2>
              </div>
              <Link className="btn btn-ghost hide-sm" href="/search">
                Shop the collection <span className="arr">→</span>
              </Link>
            </div>
            <div className="pgrid">
              {displays.map(display => {
                const { product, fromCents, compareAtCents } = display;
                const onSale =
                  fromCents !== null &&
                  compareAtCents !== null &&
                  compareAtCents > fromCents;
                const imageSrc = getProductImage(product.slug);
                return (
                  <article key={product.id} className="pcard">
                    <Link
                      href={`/p/${product.slug}`}
                      className="plate"
                      aria-label={product.name}
                    >
                      {onSale ? (
                        <span className="badge badge-sale corner">Sale</span>
                      ) : null}
                      {imageSrc ? (
                        <img src={imageSrc} alt={product.name} />
                      ) : null}
                      <span className="plate-cap">{product.name}</span>
                    </Link>
                    <div className="pmeta">
                      {product.brand ? (
                        <span className="brand">{product.brand}</span>
                      ) : null}
                      <Link href={`/p/${product.slug}`} className="pname">
                        {product.name}
                      </Link>
                      {fromCents !== null ? (
                        <div className="prow">
                          {onSale ? (
                            <>
                              <span className="sale-price price">
                                {formatMoney(fromCents, config)}
                              </span>
                              <span className="strike price">
                                {formatMoney(compareAtCents, config)}
                              </span>
                            </>
                          ) : (
                            <span className="price">
                              From {formatMoney(fromCents, config)}
                            </span>
                          )}
                        </div>
                      ) : null}
                    </div>
                  </article>
                );
              })}
            </div>
          </div>
        </section>
      ) : (
        <section className="section">
          <div className="wrap-wide center" style={{ color: 'var(--ink-3)' }}>
            Our catalog is being stocked. Check back soon.
          </div>
        </section>
      )}

      {/* POPULAR CATEGORIES */}
      {categories.length > 0 ? (
        <section className="section paper2">
          <div className="wrap-wide">
            <div
              className="between"
              style={{ marginBottom: 26, alignItems: 'flex-end' }}
            >
              <h2 className="h-lg">Shop by category</h2>
              <Link className="btn btn-quiet hide-sm" href="/search">
                All categories <span className="arr">→</span>
              </Link>
            </div>
            <div className="cat-grid">
              {categories.map(cat => {
                const imageSrc = getCategoryImage(cat.slug);
                return (
                  <Link key={cat.id} href={`/c/${cat.slug}`} className="cat-tile">
                    {imageSrc ? (
                      <img
                        src={imageSrc}
                        alt={cat.name}
                        style={{ aspectRatio: '4/3', width: '100%', objectFit: 'cover', display: 'block' }}
                      />
                    ) : (
                      <div className="ph clean" data-label={cat.name} />
                    )}
                    <div className="cat-cap">
                      <span>{cat.name}</span>
                      <span className="ucap" style={{ color: 'var(--clay-deep)' }}>
                        Shop →
                      </span>
                    </div>
                  </Link>
                );
              })}
            </div>
          </div>
        </section>
      ) : null}
    </>
  );
}
