import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { getCategoryBySlug } from '@/modules/catalog/categories';
import { listProducts, type ListProductsFilters } from '@/modules/catalog/products';
import { computeFacets } from '@/modules/catalog/facets';
import { Button } from '@/components/ui/button';
import { ProductCard } from '@/components/storefront/ProductCard';
import { FilterSidebar } from '@/components/storefront/FilterSidebar';
import { getStoreContext } from '../../_lib/context';
import { loadProductDisplays } from '../../_lib/product-pricing';

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
    <div className="container py-10">
      <header className="mb-8">
        <h1 className="font-serif text-3xl font-semibold tracking-tight text-brand">
          {category.name}
        </h1>
        {category.description ? (
          <p className="mt-2 max-w-prose text-muted-foreground">{category.description}</p>
        ) : null}
      </header>

      <div className="flex flex-col gap-8 md:flex-row">
        <FilterSidebar facets={facets} />

        <div className="flex-1">
          {displays.length === 0 ? (
            <p className="py-16 text-center text-muted-foreground">
              No products match these filters.
            </p>
          ) : (
            <>
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
      </div>
    </div>
  );
}
