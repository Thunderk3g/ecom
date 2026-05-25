import { getAdminContext } from '../_lib/context';
import { PageHeader } from '../_lib/ui';
import { flattenCategories } from '../_lib/categories';
import { getAdminCategoryTree } from '@/modules/catalog/categories';
import { CategoriesManager, type CategoryListRow } from './CategoriesManager';

export const dynamic = 'force-dynamic';

export default async function CategoriesPage() {
  const { storeId } = await getAdminContext();
  const tree = await getAdminCategoryTree(storeId);
  const flat = flattenCategories(tree);

  const rows: CategoryListRow[] = flat.map(c => ({
    id: c.id,
    label: c.label,
    name: c.name,
    depth: c.depth,
  }));

  const fullById = new Map<string, CategoryListRow>();
  function walk(nodes: typeof tree): void {
    for (const n of nodes) {
      fullById.set(n.id, {
        id: n.id,
        label: n.name,
        name: n.name,
        depth: 0,
        slug: n.slug,
        parentId: n.parentId,
        description: n.description,
        sortOrder: n.sortOrder,
        published: n.published,
      });
      walk(n.children);
    }
  }
  walk(tree);

  const detailed = rows.map(r => ({ ...r, ...(fullById.get(r.id) ?? {}) }));
  const options = flat.map(c => ({ id: c.id, label: c.label }));

  return (
    <div className="space-y-4">
      <PageHeader
        title="Categories"
        description="Organize products into a category tree."
      />
      <CategoriesManager rows={detailed} parentOptions={options} />
    </div>
  );
}
