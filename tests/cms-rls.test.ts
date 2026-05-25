import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { resetAndMigrate } from './_setup/db';
import { migratorClient } from '@/db/client';
import { withTenant } from '@/modules/tenant/with-tenant';
import { contentPages, contentVersions, navigationMenus } from '@/db/schema/cms';
import { createPage, publishPage, listPages, getPageBySlug } from '@/modules/cms/pages';
import { upsertMenu, getMenu } from '@/modules/cms/navigation';

describe('cms RLS — cross-tenant isolation', () => {
  let storeA: string;
  let storeB: string;
  let pageAId: string;

  beforeAll(async () => {
    await resetAndMigrate();
    await migratorClient`INSERT INTO stores (slug, name) VALUES ('cms-a', 'A'), ('cms-b', 'B')`;
    const rows = await migratorClient<{ id: string; slug: string }[]>`
      SELECT id, slug FROM stores WHERE slug IN ('cms-a', 'cms-b') ORDER BY slug
    `;
    storeA = rows.find(r => r.slug === 'cms-a')!.id;
    storeB = rows.find(r => r.slug === 'cms-b')!.id;

    const { page } = await createPage(storeA, {
      slug: 'home',
      title: 'A Home',
      blocks: [{ kind: 'rich-text', props: { markdown: 'A only' } }],
    });
    pageAId = page.id;
    await publishPage(storeA, pageAId);

    await createPage(storeB, { slug: 'home', title: 'B Home' });
    await upsertMenu(storeA, 'header', [{ label: 'A nav', href: '/' }]);
    await upsertMenu(storeB, 'header', [{ label: 'B nav', href: '/' }]);
  });

  afterAll(async () => {
    await migratorClient.end();
  });

  it("store B cannot see store A's pages via listPages", async () => {
    const bPages = await listPages(storeB);
    expect(bPages.map(p => p.id)).not.toContain(pageAId);
    const aPages = await listPages(storeA);
    expect(aPages.map(p => p.id)).toContain(pageAId);
  });

  it("a published page in A is not served under B's slug read", async () => {
    const bHome = await getPageBySlug(storeB, 'home');
    // B's home exists but is unpublished → null; and it is definitely not A's content.
    expect(bHome).toBeNull();
    const aHome = await getPageBySlug(storeA, 'home');
    expect(aHome).not.toBeNull();
    expect((aHome!.blocks[0]!.props as { markdown: string }).markdown).toBe('A only');
  });

  it('navigation menus are isolated per store', async () => {
    const aMenu = await getMenu(storeA, 'header');
    const bMenu = await getMenu(storeB, 'header');
    expect((aMenu!.items[0] as { label: string }).label).toBe('A nav');
    expect((bMenu!.items[0] as { label: string }).label).toBe('B nav');
  });

  it("INSERT into content_pages with another store's id raises an RLS violation", async () => {
    let caught: unknown;
    try {
      await withTenant(storeA, async tx => {
        await tx.insert(contentPages).values({
          storeId: storeB,
          slug: 'sneaky',
          title: 'Cross-tenant',
        });
      });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeDefined();
    const root = (caught as { cause?: unknown }).cause ?? caught;
    const msg = String((root as Error).message ?? '');
    const code = (root as { code?: string }).code;
    expect(/row-level security|policy|new row violates/i.test(msg) || code === '42501').toBe(true);
  });

  it("INSERT into content_versions with another store's id raises an RLS violation", async () => {
    let caught: unknown;
    try {
      await withTenant(storeA, async tx => {
        await tx.insert(contentVersions).values({
          storeId: storeB,
          pageId: pageAId,
          blocks: [],
        });
      });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeDefined();
    const root = (caught as { cause?: unknown }).cause ?? caught;
    const msg = String((root as Error).message ?? '');
    const code = (root as { code?: string }).code;
    expect(/row-level security|policy|new row violates/i.test(msg) || code === '42501').toBe(true);
  });

  it("INSERT into navigation_menus with another store's id raises an RLS violation", async () => {
    let caught: unknown;
    try {
      await withTenant(storeA, async tx => {
        await tx.insert(navigationMenus).values({
          storeId: storeB,
          slot: 'footer',
          items: [],
        });
      });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeDefined();
    const root = (caught as { cause?: unknown }).cause ?? caught;
    const msg = String((root as Error).message ?? '');
    const code = (root as { code?: string }).code;
    expect(/row-level security|policy|new row violates/i.test(msg) || code === '42501').toBe(true);
  });

  it('migratorDb (BYPASSRLS) sees both stores — proves RLS is the filter', async () => {
    const all = await migratorClient<{ id: string; store_id: string }[]>`
      SELECT id, store_id FROM content_pages
    `;
    const storeIds = all.map(r => r.store_id);
    expect(storeIds).toContain(storeA);
    expect(storeIds).toContain(storeB);
  });
});
