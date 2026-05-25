import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { resetAndMigrate } from './_setup/db';
import { migratorClient } from '@/db/client';
import { createProduct } from '@/modules/catalog/products';
import { createVariant } from '@/modules/catalog/variants';
import {
  addBundleComponent,
  expandBundle,
} from '@/modules/catalog/bundles';
import { BundleSelfReferenceError } from '@/modules/catalog/errors';

describe('catalog bundles', () => {
  let storeId: string;
  let bundleVariantId: string;
  let compAId: string;
  let compBId: string;

  beforeAll(async () => {
    await resetAndMigrate();
    await migratorClient`INSERT INTO stores (slug, name) VALUES ('bundles', 'Bundles Store')`;
    const rows = await migratorClient<{ id: string }[]>`
      SELECT id FROM stores WHERE slug = 'bundles'
    `;
    storeId = rows[0]!.id;

    // Bundle parent product.
    const bundleProduct = await createProduct(storeId, {
      slug: 'starter-kit',
      name: 'Starter Kit',
      type: 'bundle',
      status: 'active',
    });
    const bundleVariant = await createVariant(storeId, bundleProduct.id, {
      sku: 'SK-MAIN',
      priceCents: 49900,
    });
    bundleVariantId = bundleVariant.id;

    // Two component products with one variant each.
    const compA = await createProduct(storeId, {
      slug: 'pen-blue',
      name: 'Blue Pen',
      status: 'active',
    });
    const compAVariant = await createVariant(storeId, compA.id, {
      sku: 'PEN-BLUE',
      priceCents: 9900,
    });
    compAId = compAVariant.id;

    const compB = await createProduct(storeId, {
      slug: 'eraser-soft',
      name: 'Soft Eraser',
      status: 'active',
    });
    const compBVariant = await createVariant(storeId, compB.id, {
      sku: 'ERASER-SOFT',
      priceCents: 4900,
    });
    compBId = compBVariant.id;
  });

  afterAll(async () => {
    await migratorClient.end();
  });

  it('addBundleComponent attaches components; expandBundle decomposes to {variantId, qty} list', async () => {
    await addBundleComponent(storeId, bundleVariantId, compAId, 2);
    await addBundleComponent(storeId, bundleVariantId, compBId, 3);

    const expanded = await expandBundle(storeId, bundleVariantId);
    expect(expanded).toHaveLength(2);

    const byId = new Map(expanded.map(c => [c.componentVariantId, c.qty]));
    expect(byId.get(compAId)).toBe(2);
    expect(byId.get(compBId)).toBe(3);
  });

  it('BundleSelfReferenceError when a bundle variant is added to its own bundle', async () => {
    await expect(
      addBundleComponent(storeId, bundleVariantId, bundleVariantId, 1),
    ).rejects.toBeInstanceOf(BundleSelfReferenceError);
  });

  it('expandBundle on a bundle without components returns []', async () => {
    // Create a second bundle that has no components attached.
    const emptyBundleProduct = await createProduct(storeId, {
      slug: 'empty-kit',
      name: 'Empty Kit',
      type: 'bundle',
      status: 'active',
    });
    const emptyBundleVariant = await createVariant(storeId, emptyBundleProduct.id, {
      sku: 'EK-MAIN',
      priceCents: 9900,
    });
    const result = await expandBundle(storeId, emptyBundleVariant.id);
    expect(result).toEqual([]);
  });
});
