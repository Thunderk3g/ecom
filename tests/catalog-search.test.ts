import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { resetAndMigrate } from './_setup/db';
import { migratorClient } from '@/db/client';
import {
  createCategory,
  type CategoryRow,
} from '@/modules/catalog/categories';
import { createProduct } from '@/modules/catalog/products';
import { searchProducts } from '@/modules/catalog/search';

/**
 * Realistic-ish corpus of 50 stationery products. The list is biased towards
 * a few brand/category clusters so filter combinations have something to
 * narrow on, while still containing the exact "Notebook" hit used for the
 * typo-tolerance assertion.
 */
function buildCorpus() {
  const items: Array<{
    slug: string;
    name: string;
    brand: string;
    descriptionMd: string;
    category: 'notebooks' | 'pens' | 'art';
  }> = [];

  // Notebooks (mix of brands).
  const notebookNames = [
    'Notebook A5 Ruled',
    'Notebook A4 Dotted',
    'Hardcover Notebook',
    'Pocket Notebook',
    'Travel Notebook',
    'Spiral Notebook',
    'Composition Notebook',
    'Grid Notebook',
    'Leather Notebook',
    'Bullet Notebook',
    'Journal Notebook',
    'Sketch Notebook',
    'Recycled Notebook',
    'Premium Notebook',
    'Mini Notebook',
    'Refill Notebook',
    'Wirebound Notebook',
    'Soft Cover Notebook',
    'Lined Notebook',
    'Field Notebook',
  ];
  const brands = ['Inkwell', 'Quillmark', 'Paperline'];
  notebookNames.forEach((name, i) => {
    items.push({
      slug: `notebook-${i}`,
      name,
      brand: brands[i % brands.length]!,
      descriptionMd: `A quality ${name.toLowerCase()} from our stationery line.`,
      category: 'notebooks',
    });
  });

  // Pens.
  const penNames = [
    'Gel Pen Black',
    'Rollerball Pen',
    'Fountain Pen Classic',
    'Ballpoint Pen Blue',
    'Fineliner Pen',
    'Brush Pen',
    'Highlighter Pen',
    'Erasable Pen',
    'Calligraphy Pen',
    'Refillable Pen',
    'Metal Pen',
    'Wooden Pen',
    'Gift Pen Set',
    'Marker Pen',
    'Twin-tip Pen',
  ];
  penNames.forEach((name, i) => {
    items.push({
      slug: `pen-${i}`,
      name,
      brand: brands[i % brands.length]!,
      descriptionMd: `Smooth writing ${name.toLowerCase()}.`,
      category: 'pens',
    });
  });

  // Art supplies.
  const artNames = [
    'Watercolour Paint Set',
    'Acrylic Paint Tube',
    'Oil Pastels Box',
    'Charcoal Sticks',
    'Drawing Pencils Set',
    'Sketchbook A3',
    'Canvas Boards Pack',
    'Paintbrush Bundle',
    'Coloured Pencils',
    'Soft Erasers Set',
    'Eraser Holder',
    'Drawing Ruler',
    'Compass Set',
    'Palette Knife',
    'Tracing Paper',
  ];
  artNames.forEach((name, i) => {
    items.push({
      slug: `art-${i}`,
      name,
      brand: brands[i % brands.length]!,
      descriptionMd: `Art supply: ${name.toLowerCase()}.`,
      category: 'art',
    });
  });

  return items;
}

describe('catalog search', () => {
  let storeId: string;
  let categories: Record<'notebooks' | 'pens' | 'art', CategoryRow>;

  beforeAll(async () => {
    await resetAndMigrate();
    await migratorClient`INSERT INTO stores (slug, name) VALUES ('search', 'Search Store')`;
    const rows = await migratorClient<{ id: string }[]>`
      SELECT id FROM stores WHERE slug = 'search'
    `;
    storeId = rows[0]!.id;

    const notebooks = await createCategory(storeId, {
      slug: 'notebooks',
      name: 'Notebooks',
    });
    const pens = await createCategory(storeId, { slug: 'pens', name: 'Pens' });
    const art = await createCategory(storeId, { slug: 'art', name: 'Art' });
    categories = { notebooks, pens, art };

    const corpus = buildCorpus();
    for (const item of corpus) {
      await createProduct(storeId, {
        slug: item.slug,
        name: item.name,
        brand: item.brand,
        descriptionMd: item.descriptionMd,
        categoryId: categories[item.category].id,
        status: 'active',
      });
    }
  }, 60_000);

  afterAll(async () => {
    await migratorClient.end();
  });

  it('exact match scores highest (top-ranked result for "Notebook" is a Notebook)', async () => {
    const { items } = await searchProducts(storeId, 'Notebook', { limit: 5 });
    expect(items.length).toBeGreaterThan(0);
    const top = items[0]!;
    expect(top.name.toLowerCase()).toContain('notebook');
    // The top-5 set should be dominated by notebook results.
    const notebookHits = items.filter(i => i.name.toLowerCase().includes('notebook')).length;
    expect(notebookHits).toBeGreaterThanOrEqual(3);
  });

  it('typo "noteboook" returns Notebook products via trigram similarity', async () => {
    const { items } = await searchProducts(storeId, 'noteboook', { limit: 5 });
    expect(items.length).toBeGreaterThan(0);
    const namesLower = items.map(i => i.name.toLowerCase());
    expect(namesLower.some(n => n.includes('notebook'))).toBe(true);
  });

  it('filter combination (category + brand) narrows the result set', async () => {
    // All notebooks under brand Inkwell.
    const inkwellNotebooks = await searchProducts(storeId, 'Notebook', {
      limit: 200,
      filters: {
        categoryId: categories.notebooks.id,
        brand: 'Inkwell',
      },
    });
    expect(inkwellNotebooks.items.length).toBeGreaterThan(0);
    for (const p of inkwellNotebooks.items) {
      expect(p.categoryId).toBe(categories.notebooks.id);
      expect(p.brand).toBe('Inkwell');
    }

    // Same query with broader filters (category only) must return >= as many.
    const allNotebooks = await searchProducts(storeId, 'Notebook', {
      limit: 200,
      filters: { categoryId: categories.notebooks.id },
    });
    expect(allNotebooks.items.length).toBeGreaterThanOrEqual(inkwellNotebooks.items.length);
  });
});
