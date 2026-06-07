import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getAdminContext } from '../../_lib/context';
import { flattenCategories } from '../../_lib/categories';
import { statpillClass, statusLabel } from '../../orders/_status';
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
    <>
      <div className="between" style={{ marginBottom: 20 }}>
        <div className="row" style={{ gap: 14 }}>
          <Link
            href={'/admin/products' as Parameters<typeof Link>[0]['href']}
            className="icon-btn"
            style={{ color: 'var(--ink-2)' }}
            aria-label="Back to products"
          >
            ←
          </Link>
          <div>
            <div className="row" style={{ gap: 10 }}>
              <h2 className="h-md" style={{ fontFamily: 'var(--serif)' }}>
                {product.name}
              </h2>
              <span className={`statpill ${statpillClass(product.status)}`}>
                {statusLabel(product.status)}
              </span>
            </div>
            <span className="t-sub">/{product.slug}</span>
          </div>
        </div>
      </div>
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
    </>
  );
}
