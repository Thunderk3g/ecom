import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { resetAndMigrate } from './_setup/db';
import { migratorClient } from '@/db/client';
import {
  getMenu,
  upsertMenu,
  validateNavItems,
  NAV_SLOTS,
} from '@/modules/cms/navigation';
import { BlockValidationError } from '@/modules/cms/errors';

describe('cms navigation — upsert + tree validation', () => {
  let storeId: string;

  beforeAll(async () => {
    await resetAndMigrate();
    await migratorClient`INSERT INTO stores (slug, name) VALUES ('cms-nav', 'CMS Nav')`;
    const rows = await migratorClient<{ id: string }[]>`SELECT id FROM stores WHERE slug = 'cms-nav'`;
    storeId = rows[0]!.id;
  });

  afterAll(async () => {
    await migratorClient.end();
  });

  it('exposes the three slots', () => {
    expect(NAV_SLOTS.slice().sort()).toEqual(['footer', 'header', 'mobile']);
  });

  it('getMenu returns null when no menu exists', async () => {
    expect(await getMenu(storeId, 'header')).toBeNull();
  });

  it('validates a nested nav tree', () => {
    const items = validateNavItems([
      { label: 'Shop', children: [{ label: 'Notebooks', href: '/c/notebooks' }] },
      { label: 'About', href: '/pages/about' },
    ]);
    expect(items).toHaveLength(2);
    expect(items[0]!.children).toHaveLength(1);
  });

  it('rejects a nav item missing its label', () => {
    let caught: unknown;
    try {
      validateNavItems([{ href: '/x' }]);
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(BlockValidationError);
    expect((caught as BlockValidationError).issues.join(' ')).toMatch(/label/);
  });

  it('rejects a bad node nested deep in the tree', () => {
    expect(() => validateNavItems([
      { label: 'Top', children: [{ label: '', href: '/y' }] },
    ])).toThrow(BlockValidationError);
  });

  it('upsertMenu inserts then replaces on the same slot (unique store,slot)', async () => {
    const first = await upsertMenu(storeId, 'header', [
      { label: 'Home', href: '/' },
    ]);
    expect(first.items).toHaveLength(1);

    const second = await upsertMenu(storeId, 'header', [
      { label: 'Home', href: '/' },
      { label: 'Shop', href: '/c/notebooks' },
    ]);
    expect(second.id).toBe(first.id); // same row replaced, not a new one
    expect(second.items).toHaveLength(2);

    const fetched = await getMenu(storeId, 'header');
    expect(fetched!.items).toHaveLength(2);
  });

  it('upsertMenu rejects an invalid tree before writing', async () => {
    await expect(upsertMenu(storeId, 'footer', [{ notLabel: 'x' }]))
      .rejects.toBeInstanceOf(BlockValidationError);
    expect(await getMenu(storeId, 'footer')).toBeNull();
  });
});
