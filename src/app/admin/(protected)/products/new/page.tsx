import { getAdminContext } from '../../_lib/context';
import { PageHeader } from '../../_lib/ui';
import { flattenCategories } from '../../_lib/categories';
import { getAdminCategoryTree } from '@/modules/catalog/categories';
import { ProductEditor } from '../ProductEditor';

export const dynamic = 'force-dynamic';

export default async function NewProductPage() {
  const { storeId } = await getAdminContext();
  const tree = await getAdminCategoryTree(storeId);
  const categories = flattenCategories(tree).map(c => ({ id: c.id, label: c.label }));

  return (
    <div className="space-y-4">
      <PageHeader title="New product" description="Create a catalog product." />
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
    </div>
  );
}
