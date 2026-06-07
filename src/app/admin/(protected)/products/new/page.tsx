import { getAdminContext } from '../../_lib/context';
import { flattenCategories } from '../../_lib/categories';
import { getAdminCategoryTree } from '@/modules/catalog/categories';
import { ProductEditor } from '../ProductEditor';

export const dynamic = 'force-dynamic';

export default async function NewProductPage() {
  const { storeId } = await getAdminContext();
  const tree = await getAdminCategoryTree(storeId);
  const categories = flattenCategories(tree).map(c => ({ id: c.id, label: c.label }));

  return (
    <>
      <div className="between" style={{ marginBottom: 20 }}>
        <div>
          <h2 className="h-md" style={{ fontFamily: 'var(--serif)' }}>
            New product
          </h2>
          <p className="t-sub" style={{ marginTop: 4 }}>
            Create a catalog product.
          </p>
        </div>
      </div>
      <ProductEditor
        mode="create"
        initial={{
          slug: '',
          name: '',
          descriptionMd: '',
          brand: '',
          categoryId: '',
          type: 'simple',
          status: 'draft',
          seoTitle: '',
          seoDescription: '',
        }}
        categories={categories}
        variants={[]}
      />
    </>
  );
}
