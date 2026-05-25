import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { resetAndMigrate } from './_setup/db';
import { migratorClient } from '@/db/client';
import {
  createProduct,
  listProducts,
  getProductBySlug,
  softDeleteProduct,
} from '@/modules/catalog/products';

describe('catalog products', () => {
  let storeId: string;

  beforeAll(async () => {
    await resetAndMigrate();
    await migratorClient`INSERT INTO stores (slug, name) VALUES ('prods', 'Prods Store')`;
    const rows = await migratorClient<{ id: string }[]>`
      SELECT id FROM stores WHERE slug = 'prods'
    `;
    storeId = rows[0]!.id;
  });

  afterAll(async () => {
    await migratorClient.end();
  });

  it('creates a product and looks it up by slug', async () => {
    const created = await createProduct(storeId, {
      slug: 'classic-notebook',
      name: 'Classic Notebook',
      status: 'active',
    });
    expect(created.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(created.slug).toBe('classic-notebook');

    const fetched = await getProductBySlug(storeId, 'classic-notebook');
    expect(fetched).not.toBeNull();
    expect(fetched!.id).toBe(created.id);
    expect(fetched!.variants).toEqual([]);
    expect(fetched!.images).toEqual([]);
  });

  it('getProductBySlug returns null (404 sentinel) for unknown slug', async () => {
    const missing = await getProductBySlug(storeId, 'does-not-exist');
    expect(missing).toBeNull();
  });

  it('paginates 24 products in 3 pages of 10 with no duplicates', async () => {
    // Seed 24 products with deterministic slugs. Note: cursor sorts by
    // (createdAt DESC, id DESC), so we want spread-out createdAt by inserting
    // sequentially. Tiny delays inside Postgres' now() are typically enough
    // because each createProduct opens its own transaction, but we sleep a
    // single millisecond between inserts to be safe across fast hardware.
    const seededIds: string[] = [];
    for (let i = 0; i < 24; i++) {
      const padded = String(i).padStart(2, '0');
      const p = await createProduct(storeId, {
        slug: `paged-${padded}`,
        name: `Paged Product ${padded}`,
        status: 'active',
      });
      seededIds.push(p.id);
      // Yield to keep created_at strictly increasing across rows.
      await new Promise(r => setTimeout(r, 2));
    }

    const seen = new Set<string>();
    const collected: string[] = [];
    let cursor: string | undefined;
    let pages = 0;

    while (true) {
      const opts = cursor !== undefined ? { limit: 10, cursor } : { limit: 10 };
      const { items, nextCursor } = await listProducts(storeId, opts);
      pages++;
      // First two pages should be full; third has the remainder.
      expect(items.length).toBeGreaterThan(0);
      for (const it of items) {
        // No duplicate IDs across pages.
        expect(seen.has(it.id)).toBe(false);
        // Only the products we seeded in this test (subset of all rows).
        if (it.slug.startsWith('paged-') || it.slug === 'classic-notebook') {
          seen.add(it.id);
          collected.push(it.id);
        } else {
          seen.add(it.id);
          collected.push(it.id);
        }
      }
      if (!nextCursor) break;
      cursor = nextCursor;
      if (pages > 10) throw new Error('pagination did not terminate');
    }

    // Total products in this test = the 24 paginated + 1 classic-notebook
    // created earlier. Both must be enumerated exactly once.
    expect(pages).toBe(3);
    expect(collected.length).toBe(25);
    expect(new Set(collected).size).toBe(25);
    // All 24 seeded products surfaced.
    for (const id of seededIds) expect(collected).toContain(id);
  });

  it('softDeleteProduct excludes from default list and detail lookup', async () => {
    const target = await createProduct(storeId, {
      slug: 'about-to-delete',
      name: 'About To Delete',
      status: 'active',
    });

    const beforeDel = await listProducts(storeId, { limit: 200 });
    const beforeIds = beforeDel.items.map(i => i.id);
    expect(beforeIds).toContain(target.id);

    await softDeleteProduct(storeId, target.id);

    const afterDel = await listProducts(storeId, { limit: 200 });
    const afterIds = afterDel.items.map(i => i.id);
    expect(afterIds).not.toContain(target.id);

    const slugLookup = await getProductBySlug(storeId, 'about-to-delete');
    expect(slugLookup).toBeNull();

    // includeDeleted: true surfaces it again.
    const withDeleted = await listProducts(storeId, {
      limit: 200,
      includeDeleted: true,
    });
    expect(withDeleted.items.map(i => i.id)).toContain(target.id);
  });
});
