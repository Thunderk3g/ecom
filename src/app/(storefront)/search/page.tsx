import Link from 'next/link';
import type { Metadata } from 'next';
import { searchProducts } from '@/modules/catalog/search';
import { SearchBox } from '@/components/storefront/SearchBox';
import { formatMoney } from '../_lib/money';
import { getStoreContext } from '../_lib/context';
import { loadProductDisplays } from '../_lib/product-pricing';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: 'Search' };

type SearchParams = Record<string, string | string[] | undefined>;

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

  const result =
    q === ''
      ? { items: [], nextCursor: null }
      : await searchProducts(storeId, q, {
          limit: 24,
          filters: { status: 'active' },
          ...(after ? { cursor: after } : {}),
        });
  const displays = await loadProductDisplays(storeId, result.items);

  const nextHref = result.nextCursor
    ? `/search?q=${encodeURIComponent(q)}&after=${result.nextCursor}`
    : null;

  return (
    <div className="wrap-wide section">
      <div style={{ marginBottom: 'clamp(24px,4vw,40px)' }}>
        <span className="eyebrow">Search</span>
        <h1 className="h-lg" style={{ margin: '8px 0 20px' }}>
          {q === '' ? (
            'Find your next favourite'
          ) : (
            <>
              Results for <em>{q}</em>
            </>
          )}
        </h1>
        <SearchBox initialQuery={q} />
      </div>

      {q === '' ? (
        <p className="center" style={{ padding: '48px 0', color: 'var(--ink-3)' }}>
          Type a query above to search the catalog.
        </p>
      ) : displays.length === 0 ? (
        <p className="center" style={{ padding: '48px 0', color: 'var(--ink-3)' }}>
          No results for &ldquo;{q}&rdquo;.
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
  );
}
