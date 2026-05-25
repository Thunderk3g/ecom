import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { getAdminContext } from '../_lib/context';
import { PageHeader, CursorPager } from '../_lib/ui';
import { listProducts, type ProductStatus } from '@/modules/catalog/products';
import { getAdminCategoryTree } from '@/modules/catalog/categories';
import { flattenCategories } from '../_lib/categories';
import { ProductsTable, type ProductListRow } from './ProductsTable';
import { ProductsFilters } from './ProductsFilters';

export const dynamic = 'force-dynamic';

const STATUSES: ProductStatus[] = ['draft', 'active', 'archived'];

export default async function ProductsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const { storeId } = await getAdminContext();
  const params = await searchParams;

  const status = STATUSES.includes(params.status as ProductStatus)
    ? (params.status as ProductStatus)
    : undefined;
  const categoryId = params.categoryId || undefined;
  const brand = params.brand || undefined;
  const after = params.after || undefined;

  const [result, tree] = await Promise.all([
    listProducts(storeId, {
      ...(status ? { status } : {}),
      ...(categoryId ? { categoryId } : {}),
      ...(brand ? { brand } : {}),
      ...(after ? { cursor: after } : {}),
      limit: 50,
    }),
    getAdminCategoryTree(storeId),
  ]);

  const categoryOptions = flattenCategories(tree);
  const categoryNameById = new Map(categoryOptions.map(c => [c.id, c.name]));

  const rows: ProductListRow[] = result.items.map(p => ({
    id: p.id,
    name: p.name,
    slug: p.slug,
    status: p.status,
    brand: p.brand,
    type: p.type,
    categoryName: p.categoryId ? categoryNameById.get(p.categoryId) ?? null : null,
    updatedAt: p.updatedAt.toISOString(),
  }));

  return (
    <div className="space-y-4">
      <PageHeader
        title="Products"
        description="Catalog products, variants, and status."
        action={
          <div className="flex gap-2">
            <Button asChild variant="outline">
              <Link href={'/admin/products/import' as Parameters<typeof Link>[0]['href']}>
                Import CSV
              </Link>
            </Button>
            <Button asChild>
              <Link href={'/admin/products/new' as Parameters<typeof Link>[0]['href']}>
                New product
              </Link>
            </Button>
          </div>
        }
      />

      <ProductsFilters
        status={status ?? ''}
        categoryId={categoryId ?? ''}
        brand={brand ?? ''}
        categories={categoryOptions}
      />

      <ProductsTable rows={rows} />

      <CursorPager
        basePath="/admin/products"
        nextCursor={result.nextCursor}
        params={{ status, categoryId, brand }}
      />
    </div>
  );
}
