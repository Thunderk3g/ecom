import Link from 'next/link';
import type { Metadata } from 'next';
import { searchProducts } from '@/modules/catalog/search';
import { Button } from '@/components/ui/button';
import { ProductCard } from '@/components/storefront/ProductCard';
import { SearchBox } from '@/components/storefront/SearchBox';
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
    <div className="container py-10">
      <div className="mb-8">
        <SearchBox initialQuery={q} />
      </div>

      {q === '' ? (
        <p className="py-16 text-center text-muted-foreground">
          Type a query above to search the catalog.
        </p>
      ) : displays.length === 0 ? (
        <p className="py-16 text-center text-muted-foreground">
          No results for &ldquo;{q}&rdquo;.
        </p>
      ) : (
        <>
          <h1 className="mb-6 text-lg text-muted-foreground">
            Results for <span className="font-medium text-foreground">{q}</span>
          </h1>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
            {displays.map(display => (
              <ProductCard key={display.product.id} display={display} config={config} />
            ))}
          </div>
          {nextHref ? (
            <div className="mt-10 flex justify-center">
              <Button asChild variant="outline">
                <Link href={nextHref as Parameters<typeof Link>[0]['href']}>Load more</Link>
              </Button>
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}
