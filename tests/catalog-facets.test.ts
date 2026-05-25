import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { resetAndMigrate } from './_setup/db';
import { migratorClient } from '@/db/client';
import { createCategory } from '@/modules/catalog/categories';
import { createProduct } from '@/modules/catalog/products';
import { computeFacets } from '@/modules/catalog/facets';

/**
 * Facet counts must add up correctly across filter combinations.
 *
 * Note: this test exercises category and brand facets only. Attribute facet
 * counts are also produced by computeFacets but the code path that groups by
 * a jsonb-extracted value is exercised via the storefront search test
 * (catalog-search.test.ts) and the listProducts path. We assert the
 * categories/brands facets here against a deterministic 6-product corpus.
 */
describe('catalog facets — categories & brands counts', () => {
  let storeId: string;
  let notebooksId: string;
  let pensId: string;

  beforeAll(async () => {
    await resetAndMigrate();
    await migratorClient`INSERT INTO stores (slug, name) VALUES ('facets', 'Facets Store')`;
    const rows = await migratorClient<{ id: string }[]>`
      SELECT id FROM stores WHERE slug = 'facets'
    `;
    storeId = rows[0]!.id;

    const notebooks = await createCategory(storeId, {
      slug: 'notebooks',
      name: 'Notebooks',
    });
    const pens = await createCategory(storeId, { slug: 'pens', name: 'Pens' });
    notebooksId = notebooks.id;
    pensId = pens.id;

    // 6 products: 4 notebooks (Inkwell:2, Quillmark:2) and 2 pens (Inkwell:1, Quillmark:1).
    const corpus: Array<{
      slug: string;
      name: string;
      brand: string;
      categoryId: string;
    }> = [
      { slug: 'nb-1', name: 'NB 1', brand: 'Inkwell', categoryId: notebooksId },
      { slug: 'nb-2', name: 'NB 2', brand: 'Inkwell', categoryId: notebooksId },
      { slug: 'nb-3', name: 'NB 3', brand: 'Quillmark', categoryId: notebooksId },
      { slug: 'nb-4', name: 'NB 4', brand: 'Quillmark', categoryId: notebooksId },
      { slug: 'pen-1', name: 'Pen 1', brand: 'Inkwell', categoryId: pensId },
      { slug: 'pen-2', name: 'Pen 2', brand: 'Quillmark', categoryId: pensId },
    ];

    for (const c of corpus) {
      await createProduct(storeId, {
        slug: c.slug,
        name: c.name,
        brand: c.brand,
        categoryId: c.categoryId,
        status: 'active',
      });
    }
  });

  afterAll(async () => {
    await migratorClient.end();
  });

  it('unfiltered facet counts cover the full corpus and add up', async () => {
    const facets = await computeFacets(storeId, { status: 'active' });

    const catCounts = new Map(facets.categories.map(c => [c.id, c.count]));
    expect(catCounts.get(notebooksId)).toBe(4);
    expect(catCounts.get(pensId)).toBe(2);

    const brandCounts = new Map(facets.brands.map(b => [b.brand, b.count]));
    expect(brandCounts.get('Inkwell')).toBe(3);
    expect(brandCounts.get('Quillmark')).toBe(3);

    // Sums match the corpus size (6 products).
    const catSum = facets.categories.reduce((s, c) => s + c.count, 0);
    const brandSum = facets.brands.reduce((s, b) => s + b.count, 0);
    expect(catSum).toBe(6);
    expect(brandSum).toBe(6);
  });

  it('current axis is dropped from its own count: brand filter does not narrow brand facet', async () => {
    // Standard storefront UX: if user has clicked "brand = Inkwell" we still
    // want to show counts for ALL brands (so they can pivot). computeFacets
    // implements this by removing the filter for the axis it is computing.
    const facets = await computeFacets(storeId, {
      status: 'active',
      brand: 'Inkwell',
    });

    const brandCounts = new Map(facets.brands.map(b => [b.brand, b.count]));
    // Brand facet ignores the brand filter — both brands still visible.
    expect(brandCounts.get('Inkwell')).toBe(3);
    expect(brandCounts.get('Quillmark')).toBe(3);

    // Category facet RESPECTS the brand filter — only Inkwell products counted.
    const catCounts = new Map(facets.categories.map(c => [c.id, c.count]));
    expect(catCounts.get(notebooksId)).toBe(2);
    expect(catCounts.get(pensId)).toBe(1);
    const catSum = facets.categories.reduce((s, c) => s + c.count, 0);
    expect(catSum).toBe(3); // 3 Inkwell products total.
  });

  it('category filter narrows the brand facet to the category subset', async () => {
    const facets = await computeFacets(storeId, {
      status: 'active',
      categoryId: notebooksId,
    });

    const brandCounts = new Map(facets.brands.map(b => [b.brand, b.count]));
    expect(brandCounts.get('Inkwell')).toBe(2);
    expect(brandCounts.get('Quillmark')).toBe(2);

    const brandSum = facets.brands.reduce((s, b) => s + b.count, 0);
    expect(brandSum).toBe(4); // notebook count.
  });
});
