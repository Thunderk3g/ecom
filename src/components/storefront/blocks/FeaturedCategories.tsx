import { getCategoryTree, type CategoryNode } from '@/modules/catalog/categories';
import { CategoryTiles, type CategoryTileData } from './CategoryTiles';

export type FeaturedCategoriesProps = {
  heading?: string;
  categorySlugs: string[];
};

/**
 * Featured-categories block. Resolves the configured slugs against the
 * published category tree (one query, and it carries the children each
 * department can advertise on its tile) and renders the shared asymmetric
 * mosaic. Missing/unpublished slugs are skipped so a stale CMS reference
 * never 500s the page.
 */
export async function FeaturedCategories({
  storeId,
  heading,
  categorySlugs,
}: FeaturedCategoriesProps & { storeId: string }) {
  const tree = await getCategoryTree(storeId);
  const bySlug = new Map<string, CategoryNode>();
  const index = (nodes: CategoryNode[]): void => {
    for (const node of nodes) {
      bySlug.set(node.slug, node);
      index(node.children);
    }
  };
  index(tree);

  const tiles: CategoryTileData[] = categorySlugs
    .map(slug => bySlug.get(slug))
    .filter((node): node is CategoryNode => node !== undefined)
    .map(node => ({
      id: node.id,
      slug: node.slug,
      name: node.name,
      description: node.description,
      childNames: node.children.map(child => child.name),
    }));

  if (tiles.length === 0) return null;

  return (
    <section className="section hm-cats-sec">
      <div className="wrap-wide">
        <CategoryTiles eyebrow="Departments" heading={heading} tiles={tiles} />
      </div>
    </section>
  );
}
