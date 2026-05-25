import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { resetAndMigrate } from './_setup/db';
import { migratorClient } from '@/db/client';
import { createProduct } from '@/modules/catalog/products';
import { matrixCreate } from '@/modules/catalog/variants';

describe('catalog variants — matrixCreate', () => {
  let storeId: string;
  let productId: string;

  beforeAll(async () => {
    await resetAndMigrate();
    await migratorClient`INSERT INTO stores (slug, name) VALUES ('vars', 'Vars Store')`;
    const rows = await migratorClient<{ id: string }[]>`
      SELECT id FROM stores WHERE slug = 'vars'
    `;
    storeId = rows[0]!.id;

    const product = await createProduct(storeId, {
      slug: 'spiral-notebook',
      name: 'Spiral Notebook',
      status: 'active',
    });
    productId = product.id;
  });

  afterAll(async () => {
    await migratorClient.end();
  });

  it('matrixCreate with 2x3 axes produces 6 variants with unique SKUs', async () => {
    const variants = await matrixCreate(
      storeId,
      productId,
      {
        size: ['A4', 'A5'],
        color: ['red', 'blue', 'green'],
      },
      {
        priceCents: 19900,
        skuPrefix: 'SPN',
      },
    );

    expect(variants).toHaveLength(6);

    const skus = variants.map(v => v.sku);
    const expectedSkus = [
      'SPN-A4-red',
      'SPN-A4-blue',
      'SPN-A4-green',
      'SPN-A5-red',
      'SPN-A5-blue',
      'SPN-A5-green',
    ];
    expect(skus.sort()).toEqual(expectedSkus.sort());

    // All SKUs unique.
    expect(new Set(skus).size).toBe(skus.length);

    // Every variant carries the cartesian axes payload.
    for (const v of variants) {
      expect(v.priceCents).toBe(19900);
      expect(v.productId).toBe(productId);
      expect(v.storeId).toBe(storeId);
      expect(typeof v.axes.size).toBe('string');
      expect(typeof v.axes.color).toBe('string');
      expect(['A4', 'A5']).toContain(v.axes.size);
      expect(['red', 'blue', 'green']).toContain(v.axes.color);
    }
  });
});
