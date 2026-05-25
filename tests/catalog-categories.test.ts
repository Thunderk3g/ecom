import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { resetAndMigrate } from './_setup/db';
import { migratorClient } from '@/db/client';
import {
  createCategory,
  getCategoryTree,
  getAdminCategoryTree,
  type CategoryNode,
} from '@/modules/catalog/categories';

describe('catalog categories', () => {
  let storeId: string;

  beforeAll(async () => {
    await resetAndMigrate();
    await migratorClient`INSERT INTO stores (slug, name) VALUES ('cats', 'Cats Store')`;
    const rows = await migratorClient<{ id: string }[]>`
      SELECT id FROM stores WHERE slug = 'cats'
    `;
    storeId = rows[0]!.id;
  });

  afterAll(async () => {
    await migratorClient.end();
  });

  it('builds a 3-level tree with correct nesting and excludes unpublished children', async () => {
    // Level 1 (root)
    const root = await createCategory(storeId, {
      slug: 'paper',
      name: 'Paper Products',
      sortOrder: 1,
    });

    // Level 2 (two children)
    const notebooks = await createCategory(storeId, {
      slug: 'notebooks',
      name: 'Notebooks',
      parentId: root.id,
      sortOrder: 1,
    });
    const padsAndPlanners = await createCategory(storeId, {
      slug: 'pads-and-planners',
      name: 'Pads & Planners',
      parentId: root.id,
      sortOrder: 2,
    });

    // Level 3 — under Notebooks
    const ruled = await createCategory(storeId, {
      slug: 'ruled-notebooks',
      name: 'Ruled Notebooks',
      parentId: notebooks.id,
      sortOrder: 1,
    });
    const dotted = await createCategory(storeId, {
      slug: 'dotted-notebooks',
      name: 'Dotted Notebooks',
      parentId: notebooks.id,
      sortOrder: 2,
    });

    // One unpublished child — should be excluded from storefront tree.
    const hiddenDraft = await createCategory(storeId, {
      slug: 'draft-notebooks',
      name: 'Draft Notebooks',
      parentId: notebooks.id,
      sortOrder: 3,
      published: false,
    });

    const tree = await getCategoryTree(storeId);
    expect(tree).toHaveLength(1);

    const rootNode = tree[0]!;
    expect(rootNode.id).toBe(root.id);
    expect(rootNode.slug).toBe('paper');
    expect(rootNode.children).toHaveLength(2);

    const childSlugs = rootNode.children.map(c => c.slug);
    expect(childSlugs).toEqual(['notebooks', 'pads-and-planners']);

    const notebooksNode = rootNode.children.find(c => c.id === notebooks.id) as CategoryNode;
    expect(notebooksNode).toBeDefined();
    expect(notebooksNode.children).toHaveLength(2);
    const grandchildSlugs = notebooksNode.children.map(c => c.slug);
    expect(grandchildSlugs.sort()).toEqual(['dotted-notebooks', 'ruled-notebooks']);
    expect(grandchildSlugs).not.toContain('draft-notebooks');

    // Pads sibling should have no children.
    const padsNode = rootNode.children.find(c => c.id === padsAndPlanners.id);
    expect(padsNode!.children).toEqual([]);

    // Admin tree should include the draft.
    const adminTree = await getAdminCategoryTree(storeId);
    const adminRoot = adminTree.find(n => n.id === root.id)!;
    const adminNotebooks = adminRoot.children.find(c => c.id === notebooks.id)!;
    const adminGrandSlugs = adminNotebooks.children.map(c => c.slug);
    expect(adminGrandSlugs).toContain('draft-notebooks');

    // Silence unused linter on grandchildren refs.
    void ruled;
    void dotted;
    void hiddenDraft;
  });
});
