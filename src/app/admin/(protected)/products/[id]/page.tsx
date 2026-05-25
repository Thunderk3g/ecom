import { notFound } from 'next/navigation';
import { getAdminContext } from '../../_lib/context';
import { PageHeader } from '../../_lib/ui';
import { flattenCategories } from '../../_lib/categories';
import { getProductBySlug, getProductById } from '@/modules/catalog/products';
import { listVariants } from '@/modules/catalog/variants';
import { getAdminCategoryTree } from '@/modules/catalog/categories';
import { ProductEditor, type EditorVariant } from '../ProductEditor';

export const dynamic = 'force-dynamic';

export default async function EditProductPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { storeId } = await getAdminContext();

  const product = await getProductById(storeId, id, { includeDeleted: true });
  if (!product) notFound();

  const [tree, variantRows, detail] = await Promise.all([
    getAdminCategoryTree(storeId),
    listVariants(storeId, id),
    getProductBySlug(storeId, product.slug, { includeDeleted: true }),
  ]);
  void detail;

  const categories = flattenCategories(tree).map(c => ({ id: c.id, label: c.label }));
  const variants: EditorVariant[] = variantRows.map(v => ({
    id: v.id,
    sku: v.sku,
    name: v.name,
    priceCents: v.priceCents,
    compareAtCents: v.compareAtCents,
    status: v.status,
  }));

  return (
    <div className="space-y-4">
      <PageHeader title={product.name} description={`/${product.slug}`} />
      <ProductEditor
        mode="edit"
        productId={product.id}
        initial={{
          slug: product.slug,
          name: product.name,
          descriptionMd: product.descriptionMd ?? '',
          brand: product.brand ?? '',
          categoryId: product.categoryId ?? '',
          type: product.type,
          status: product.status,
          seoTitle: product.seo?.title ?? '',
          seoDescription: product.seo?.description ?? '',
        }}
        categories={categories}
        variants={variants}
      />
    </div>
  );
}
