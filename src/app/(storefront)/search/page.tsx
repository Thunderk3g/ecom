import Link from 'next/link';
import type { Metadata } from 'next';
import { searchProducts } from '@/modules/catalog/search';
import { getCategoryTree } from '@/modules/catalog/categories';
import { SearchBox } from '@/components/storefront/SearchBox';
import { ProductCard } from '@/components/storefront/ProductCard';
import { SortSelect } from '@/components/storefront/SortSelect';
import { MediaPlaceholder } from '@/components/storefront/MediaPlaceholder';
import { Stagger } from '@/components/storefront/motion';
import { getStoreContext } from '../_lib/context';
import { loadListingCards, sortListingCards } from '../_lib/listing-cards';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: 'Search' };

type SearchParams = Record<string, string | string[] | undefined>;

const SORT_OPTIONS = [
  { value: 'relevance', label: 'Relevance' },
  { value: 'price-asc', label: 'Price: Low to High' },
  { value: 'price-desc', label: 'Price: High to Low' },
  { value: 'name-asc', label: 'Name: A to Z' },
];

function readString(sp: SearchParams, key: string): string | undefined {
  const v = sp[key];
  return Array.isArray(v) ? v[0] : v;
}

export default async function SearchPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const sp = await searchParams;
  const { storeId, config } = await getStoreContext();
  const q = readString(sp, 'q')?.trim() ?? '';
  const after = readString(sp, 'after');
  const sort = readString(sp, 'sort');

  // Departments (published root categories) — suggested from empty/zero states.
  const departments = (await getCategoryTree(storeId)).filter(c => c.published);

  const result =
    q === ''
      ? { items: [], nextCursor: null }
      : await searchProducts(storeId, q, {
          limit: 24,
          filters: { status: 'active' },
          ...(after ? { cursor: after } : {}),
        });
  // Relevance is the fetched (FTS-ranked) order; other sorts apply within the
  // fetched page — the search module has no ORDER BY hook (see _lib/listing-cards).
  const cards = sortListingCards(await loadListingCards(storeId, result.items), sort);

  const nextParams = new URLSearchParams({ q });
  if (sort) nextParams.set('sort', sort);
  if (result.nextCursor) nextParams.set('after', result.nextCursor);
  const nextHref = result.nextCursor ? `/search?${nextParams.toString()}` : null;

  const deptChips =
    departments.length > 0 ? (
      <nav className="lst-depts" aria-label="Browse departments">
        {departments.map(dept => (
          <Link key={dept.id} href={`/c/${dept.slug}`} className="chip">
            {dept.name}
          </Link>
        ))}
      </nav>
    ) : null;

  return (
    <div className="wrap-wide section">
      <div className="lst-search-head">
        <span className="eyebrow">Search</span>
        <h1 className="h-lg" style={{ margin: '8px 0 20px' }}>
          {q === '' ? (
            'Find your next favourite'
          ) : (
            <>
              Results for <em>&ldquo;{q}&rdquo;</em>
            </>
          )}
        </h1>
        <SearchBox initialQuery={q} />
      </div>

      {q === '' ? (
        <div className="lst-empty">
          <div className="lst-empty-art">
            <MediaPlaceholder label="Search the shop" slug="stationery" aspect="4/3" showLabel={false} />
          </div>
          <h2 className="h-md">What are you looking for?</h2>
          <p className="lede">Type above, or start from a department.</p>
          {deptChips}
        </div>
      ) : cards.length === 0 ? (
        <div className="lst-empty">
          <div className="lst-empty-art">
            <MediaPlaceholder label="No results" slug={q} aspect="4/3" showLabel={false} />
          </div>
          <h2 className="h-md">No results for &ldquo;{q}&rdquo;</h2>
          <p className="lede">
            Check the spelling, try a broader word, or browse a department instead.
          </p>
          {deptChips}
        </div>
      ) : (
        <>
          <div className="lst-toolbar">
            <p className="lst-count" aria-live="polite">
              {cards.length}
              {result.nextCursor ? '+' : ''} {cards.length === 1 && !result.nextCursor ? 'result' : 'results'}
            </p>
            <SortSelect options={SORT_OPTIONS} defaultValue="relevance" />
          </div>
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
  );
}
