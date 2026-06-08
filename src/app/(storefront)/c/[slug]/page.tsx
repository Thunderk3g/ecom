import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { getCategoryBySlug } from '@/modules/catalog/categories';
import { listProducts, type ListProductsFilters } from '@/modules/catalog/products';
import { computeFacets } from '@/modules/catalog/facets';
import { FilterSidebar } from '@/components/storefront/FilterSidebar';
import { formatMoney } from '../../_lib/money';
import { getStoreContext } from '../../_lib/context';
import { loadProductDisplays } from '../../_lib/product-pricing';
import { getProductImage, getCategoryImage } from '@/utils/storefront-assets';

export const dynamic = 'force-dynamic';

type SearchParams = Record<string, string | string[] | undefined>;

function readString(sp: SearchParams, key: string): string | undefined {
  const v = sp[key];
  return Array.isArray(v) ? v[0] : v;
}

/** Build catalog filters from the request query (brand + attr_<key> axes). */
function buildFilters(categoryId: string, sp: SearchParams): ListProductsFilters {
  const filters: ListProductsFilters = { categoryId, status: 'active' };
  const brand = readString(sp, 'brand');
  if (brand) filters.brand = brand;
  const attrs: Record<string, string> = {};
  for (const [key, value] of Object.entries(sp)) {
    if (key.startsWith('attr_') && typeof value === 'string') {
      attrs[key.slice('attr_'.length)] = value;
    }
  }
  if (Object.keys(attrs).length > 0) filters.attrs = attrs;
  return filters;
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const { storeId } = await getStoreContext();
  const category = await getCategoryBySlug(storeId, slug);
  return { title: category ? category.name : 'Category' };
}

export default async function CategoryPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<SearchParams>;
}) {
  const { slug } = await params;
  const sp = await searchParams;
  const { storeId, config } = await getStoreContext();

  const category = await getCategoryBySlug(storeId, slug);
  if (!category || !category.published) notFound();

  const filters = buildFilters(category.id, sp);
  const after = readString(sp, 'after');

  const [result, facets] = await Promise.all([
    listProducts(storeId, { ...filters, limit: 24, ...(after ? { cursor: after } : {}) }),
    computeFacets(storeId, filters),
  ]);
  const displays = await loadProductDisplays(storeId, result.items);

  const nextHref = result.nextCursor
    ? `/c/${slug}?${new URLSearchParams({
        ...Object.fromEntries(
          Object.entries(sp).filter(([, v]) => typeof v === 'string') as [string, string][],
        ),
        after: result.nextCursor,
      }).toString()}`
    : null;

  return (
    <>
      {/* Category hero */}
      <section className="cat-hero">
        <div className="wrap-wide">
          <div className="crumbs" style={{ paddingTop: 18 }}>
            <Link href="/">Home</Link>
            <span className="sep">/</span>
            <Link href="/search">Shop</Link>
            <span className="sep">/</span>
            <span style={{ color: 'var(--ink)' }}>{category.name}</span>
          </div>
          <div className="cat-hero-inner">
            <div>
              <span className="eyebrow">The complete edit</span>
              <h1 className="h-xl">{category.name}</h1>
              {category.description ? (
                <p className="lede">{category.description}</p>
              ) : null}
            </div>
            {getCategoryImage(category.slug) ? (
              <img
                src={getCategoryImage(category.slug)!}
                alt={category.name}
                className="cat-hero-art"
                style={{ objectFit: 'cover' }}
              />
            ) : (
              <div
                className="ph cat-hero-art"
                data-label={category.name}
              />
            )}
          </div>
        </div>
      </section>

      <div className="wrap-wide">
        <div className="shop-layout">
          <FilterSidebar facets={facets} />

          <div>
            {displays.length === 0 ? (
              <p className="section center" style={{ color: 'var(--ink-3)' }}>
                No products match these filters.
              </p>
            ) : (
              <>
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
                {nextHref ? (
                  <div className="load-more">
                    <Link
                      className="btn btn-ghost"
                      href={nextHref as Parameters<typeof Link>[0]['href']}
                    >
                      Load more
                    </Link>
                  </div>
                ) : null}
              </>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
