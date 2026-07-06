import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import {
  getCategoryBySlug,
  getCategoryTree,
  type CategoryNode,
} from '@/modules/catalog/categories';
import { listProducts, type ListProductsFilters } from '@/modules/catalog/products';
import { computeFacets, type Facets } from '@/modules/catalog/facets';
import { FilterSidebar } from '@/components/storefront/FilterSidebar';
import { ProductCard } from '@/components/storefront/ProductCard';
import { SortSelect } from '@/components/storefront/SortSelect';
import { MediaPlaceholder } from '@/components/storefront/MediaPlaceholder';
import { Stagger, AnimatedNumber } from '@/components/storefront/motion';
import { formatMoney } from '../../_lib/money';
import { getStoreContext } from '../../_lib/context';
import {
  loadListingCards,
  sortListingCards,
  filterCardsByPrice,
  parsePriceParam,
} from '../../_lib/listing-cards';
import { getCategoryImage } from '@/utils/storefront-assets';

export const dynamic = 'force-dynamic';

type SearchParams = Record<string, string | string[] | undefined>;

const SORT_OPTIONS = [
  { value: 'new', label: 'Newest' },
  { value: 'price-asc', label: 'Price: Low to High' },
  { value: 'price-desc', label: 'Price: High to Low' },
  { value: 'name-asc', label: 'Name: A to Z' },
];

function readString(sp: SearchParams, key: string): string | undefined {
  const v = sp[key];
  return Array.isArray(v) ? v[0] : v;
}

/** Find a node and its parent in the published category tree. */
function locate(
  nodes: CategoryNode[],
  id: string,
  parent: CategoryNode | null = null,
): { node: CategoryNode; parent: CategoryNode | null } | null {
  for (const n of nodes) {
    if (n.id === id) return { node: n, parent };
    const hit = locate(n.children, id, n);
    if (hit) return hit;
  }
  return null;
}

/** All leaf categories under a node (the node itself when it is a leaf). */
function collectLeaves(node: CategoryNode): CategoryNode[] {
  if (node.children.length === 0) return [node];
  return node.children.flatMap(collectLeaves);
}

/** Build catalog filters from the request query (brand + attr_<key> axes). */
function buildFilters(
  categoryAxis: { categoryId: string } | { categoryIds: string[] },
  sp: SearchParams,
): ListProductsFilters {
  const filters: ListProductsFilters = { ...categoryAxis, status: 'active' };
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

/** Current path + query minus the given keys (pagination cursor always dropped). */
function hrefWithout(basePath: string, sp: SearchParams, removeKeys: string[]): string {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(sp)) {
    if (typeof v !== 'string' || v === '') continue;
    if (k === 'after' || removeKeys.includes(k)) continue;
    params.set(k, v);
  }
  const qs = params.toString();
  return qs ? `${basePath}?${qs}` : basePath;
}

/** Sum facet counts for a set of category ids. */
function countFor(facets: Facets, ids: string[]): number {
  const idSet = new Set(ids);
  return facets.categories.filter(c => idSet.has(c.id)).reduce((sum, c) => sum + c.count, 0);
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

  // Position in the published tree → children (parent pages), parent (crumbs),
  // and the descendant leaf set products actually attach to.
  const tree = await getCategoryTree(storeId);
  const located = locate(tree, category.id);
  const node = located?.node ?? null;
  const parent = located?.parent ?? null;
  const children = node?.children ?? [];
  const isParent = children.length > 0;
  const leaves = node ? collectLeaves(node) : [];
  const leafIds = leaves.length > 0 ? leaves.map(l => l.id) : [category.id];

  // Parent pages aggregate across ALL descendant leaves via the additive
  // `categoryIds` filter; leaf pages keep the original single-id filter.
  const filters = buildFilters(
    isParent ? { categoryIds: leafIds } : { categoryId: category.id },
    sp,
  );
  const after = readString(sp, 'after');
  const sort = readString(sp, 'sort');
  const pmin = parsePriceParam(readString(sp, 'pmin'));
  const pmax = parsePriceParam(readString(sp, 'pmax'));

  const [result, facets] = await Promise.all([
    listProducts(storeId, { ...filters, limit: 24, ...(after ? { cursor: after } : {}) }),
    computeFacets(storeId, filters),
  ]);

  // Card data (price display + quick-add wiring), then the page-local price
  // band + sort. The catalog module exposes no ORDER BY / price predicate, so
  // both apply within the fetched page of ≤24 items (see _lib/listing-cards).
  const allCards = await loadListingCards(storeId, result.items);
  const cards = sortListingCards(filterCardsByPrice(allCards, pmin, pmax), sort);

  // Result count from the category facet (respects brand/attr filters; the
  // page-local price band is reflected in the "showing" note instead).
  const matchCount = countFor(facets, leafIds);
  const priceFiltered = pmin !== null || pmax !== null;

  const basePath = `/c/${slug}`;
  const nextHref = result.nextCursor
    ? `${basePath}?${new URLSearchParams({
        ...Object.fromEntries(
          Object.entries(sp).filter(([, v]) => typeof v === 'string') as [string, string][],
        ),
        after: result.nextCursor,
      }).toString()}`
    : null;

  // Applied-filter chips (brand, attributes, price band) with per-chip clear.
  const chips: { key: string; label: string; href: string }[] = [];
  const activeBrand = readString(sp, 'brand');
  if (activeBrand) {
    chips.push({
      key: 'brand',
      label: `Brand: ${activeBrand}`,
      href: hrefWithout(basePath, sp, ['brand']),
    });
  }
  for (const [key, value] of Object.entries(sp)) {
    if (key.startsWith('attr_') && typeof value === 'string') {
      chips.push({
        key,
        label: `${key.slice('attr_'.length)}: ${value}`,
        href: hrefWithout(basePath, sp, [key]),
      });
    }
  }
  if (priceFiltered) {
    const from = pmin !== null ? formatMoney(pmin * 100, config) : null;
    const to = pmax !== null ? formatMoney(pmax * 100, config) : null;
    chips.push({
      key: 'price',
      label: from && to ? `Price: ${from}–${to}` : from ? `Price: from ${from}` : `Price: up to ${to}`,
      href: hrefWithout(basePath, sp, ['pmin', 'pmax']),
    });
  }
  const clearAllHref = hrefWithout(
    basePath,
    sp,
    chips.map(c => c.key === 'price' ? 'pmin' : c.key).concat('pmax'),
  );

  const heroImage = getCategoryImage(category.slug);

  return (
    <>
      {/* ---- Editorial category hero ---- */}
      <section className="cat-hero">
        <div className="wrap-wide">
          <nav aria-label="Breadcrumb" className="crumbs lst-crumbs">
            <Link href="/">Home</Link>
            {parent ? (
              <>
                <span className="sep" aria-hidden="true">/</span>
                <Link href={`/c/${parent.slug}`}>{parent.name}</Link>
              </>
            ) : null}
            <span className="sep" aria-hidden="true">/</span>
            <span aria-current="page" style={{ color: 'var(--ink)' }}>
              {category.name}
            </span>
          </nav>
          <div className="cat-hero-inner">
            <div>
              <span className="eyebrow">
                {isParent ? 'Department' : parent ? parent.name : 'The complete edit'}
              </span>
              <h1 className="h-xl">{category.name}</h1>
              {category.description ? <p className="lede">{category.description}</p> : null}
              <p className="lst-count-line">
                <AnimatedNumber value={matchCount} className="lst-count-num" />
                <span>
                  {matchCount === 1 ? 'product' : 'products'}
                  {isParent && children.length > 0
                    ? ` · ${children.length} collections`
                    : ''}
                </span>
              </p>
              {/* Leaf pages: quick hops across the sibling collections. */}
              {!isParent && parent ? (
                <nav className="lst-sibs" aria-label={`${parent.name} collections`}>
                  <Link className="chip chip-sm" href={`/c/${parent.slug}`}>
                    All {parent.name}
                  </Link>
                  {parent.children.map(sib => (
                    <Link
                      key={sib.id}
                      className={`chip chip-sm${sib.id === category.id ? ' is-active' : ''}`}
                      href={`/c/${sib.slug}`}
                      {...(sib.id === category.id ? { 'aria-current': 'page' as const } : {})}
                    >
                      {sib.name}
                    </Link>
                  ))}
                </nav>
              ) : null}
            </div>
            {heroImage ? (
              <img
                src={heroImage}
                alt={category.name}
                className="cat-hero-art"
                style={{ objectFit: 'cover' }}
              />
            ) : (
              <div className="cat-hero-art lst-hero-ph">
                <MediaPlaceholder
                  label={category.name}
                  slug={category.slug}
                  aspect="16/7"
                  showLabel={false}
                />
              </div>
            )}
          </div>
        </div>
      </section>

      {/* ---- Department landing: subcategory tiles ---- */}
      {isParent ? (
        <section className="wrap-wide lst-subcats" aria-label={`${category.name} collections`}>
          <Stagger className="cat-grid" interval={70}>
            {children.map(child => {
              const childImage = getCategoryImage(child.slug);
              const childCount = countFor(facets, collectLeaves(child).map(l => l.id));
              return (
                <Link key={child.id} href={`/c/${child.slug}`} className="cat-tile hover-lift">
                  {childImage ? (
                    <img src={childImage} alt="" className="lst-tile-img" loading="lazy" />
                  ) : (
                    <MediaPlaceholder label={child.name} slug={child.slug} showLabel={false} />
                  )}
                  <span className="cat-cap">
                    <span>{child.name}</span>
                    <span className="lst-cap-meta">
                      {childCount > 0 ? <span className="lst-cap-n">{childCount}</span> : null}
                      <span className="lst-cap-arr" aria-hidden="true">→</span>
                    </span>
                  </span>
                </Link>
              );
            })}
          </Stagger>
        </section>
      ) : null}

      {/* ---- Listing: toolbar + filters + grid ---- */}
      <div className="wrap-wide">
        <div className="lst-toolbar">
          <p className="lst-count" aria-live="polite">
            {priceFiltered ? (
              <>Showing {cards.length} of {matchCount} {matchCount === 1 ? 'product' : 'products'}</>
            ) : (
              <>{matchCount} {matchCount === 1 ? 'product' : 'products'}</>
            )}
          </p>
          <SortSelect options={SORT_OPTIONS} defaultValue="new" />
        </div>

        {chips.length > 0 ? (
          <div className="active-filters">
            {chips.map(chip => (
              <Link key={chip.key} href={chip.href} className="fchip" title="Remove filter">
                {chip.label}
                <span className="fx" aria-hidden="true">×</span>
              </Link>
            ))}
            <Link href={clearAllHref} className="meta link-u lst-clear-all">
              Clear all
            </Link>
          </div>
        ) : null}

        <div className="shop-layout">
          <FilterSidebar facets={facets} />

          <div>
            {cards.length === 0 ? (
              <div className="lst-empty">
                <div className="lst-empty-art">
                  <MediaPlaceholder
                    label={category.name}
                    slug={category.slug}
                    aspect="4/3"
                    showLabel={false}
                  />
                </div>
                <h2 className="h-md">Nothing here — yet</h2>
                <p className="lede">
                  {chips.length > 0
                    ? 'No products match these filters. Try loosening them.'
                    : 'This shelf is being restocked. Explore the rest of the department meanwhile.'}
                </p>
                <div className="lst-empty-actions">
                  {chips.length > 0 ? (
                    <Link className="btn btn-ghost" href={clearAllHref}>
                      Clear filters
                    </Link>
                  ) : null}
                  {parent ? (
                    <Link className="btn btn-clay" href={`/c/${parent.slug}`}>
                      Back to {parent.name} <span className="arr">→</span>
                    </Link>
                  ) : (
                    <Link className="btn btn-clay" href="/">
                      Back to the shop <span className="arr">→</span>
                    </Link>
                  )}
                </div>
              </div>
            ) : (
              <>
                <Stagger className="pgrid" interval={70}>
                  {cards.map(card => (
                    <ProductCard
                      key={card.product.id}
                      display={card}
                      config={config}
                      {...(card.quickAdd ? { quickAdd: card.quickAdd } : {})}
                    />
                  ))}
                </Stagger>
                {nextHref ? (
                  <div className="load-more">
                    <Link className="btn btn-ghost" href={nextHref}>
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
