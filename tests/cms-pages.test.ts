import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { resetAndMigrate } from './_setup/db';
import { migratorClient } from '@/db/client';
import {
  createPage,
  updateDraft,
  publishPage,
  unpublishPage,
  getPageBySlug,
  getPageAdmin,
  listPages,
  deletePage,
} from '@/modules/cms/pages';
import { PageNotFoundError, SlugConflictError, VersionNotFoundError } from '@/modules/cms/errors';

describe('cms pages — create / draft / publish pointer-swap', () => {
  let storeId: string;

  beforeAll(async () => {
    await resetAndMigrate();
    await migratorClient`INSERT INTO stores (slug, name) VALUES ('cms-pages', 'CMS Pages')`;
    const rows = await migratorClient<{ id: string }[]>`SELECT id FROM stores WHERE slug = 'cms-pages'`;
    storeId = rows[0]!.id;
  });

  afterAll(async () => {
    await migratorClient.end();
  });

  it('createPage starts in draft with a draft version and no published version', async () => {
    const { page, draft, published } = await createPage(storeId, {
      slug: 'about',
      title: 'About Us',
      blocks: [{ kind: 'rich-text', props: { markdown: '# Hello' } }],
    });
    expect(page.status).toBe('draft');
    expect(page.draftVersionId).toBe(draft!.id);
    expect(page.publishedVersionId).toBeNull();
    expect(published).toBeNull();

    // Not yet live: storefront read returns null.
    expect(await getPageBySlug(storeId, 'about')).toBeNull();
  });

  it('duplicate slug throws SlugConflictError', async () => {
    await expect(createPage(storeId, { slug: 'about', title: 'Dupe' }))
      .rejects.toBeInstanceOf(SlugConflictError);
  });

  it('publishPage swaps published_version_id := draft_version_id transactionally', async () => {
    const { page } = await createPage(storeId, {
      slug: 'faq',
      title: 'FAQ',
      blocks: [{ kind: 'rich-text', props: { markdown: 'Q&A v1' } }],
    });
    const draftV1 = page.draftVersionId!;

    const publishedPage = await publishPage(storeId, page.id);
    expect(publishedPage.status).toBe('published');
    expect(publishedPage.publishedVersionId).toBe(draftV1);

    const live = await getPageBySlug(storeId, 'faq');
    expect(live).not.toBeNull();
    expect(live!.blocks).toHaveLength(1);
    expect(live!.blocks[0]!.kind).toBe('rich-text');
  });

  it('updateDraft creates a NEW version; storefront keeps serving published until re-publish', async () => {
    const { page } = await createPage(storeId, {
      slug: 'terms',
      title: 'Terms',
      blocks: [{ kind: 'rich-text', props: { markdown: 'v1' } }],
    });
    const v1 = page.draftVersionId!;
    await publishPage(storeId, page.id);

    // Edit draft → new version. Published pointer unchanged.
    const v2 = await updateDraft(storeId, page.id, {
      blocks: [{ kind: 'rich-text', props: { markdown: 'v2' } }],
    });
    expect(v2.id).not.toBe(v1);

    const admin = await getPageAdmin(storeId, page.id);
    expect(admin.draft!.id).toBe(v2.id);
    expect(admin.published!.id).toBe(v1);

    // Storefront still serves v1.
    const liveBefore = await getPageBySlug(storeId, 'terms');
    expect((liveBefore!.blocks[0]!.props as { markdown: string }).markdown).toBe('v1');

    // Re-publish flips to v2.
    const republished = await publishPage(storeId, page.id);
    expect(republished.publishedVersionId).toBe(v2.id);
    const liveAfter = await getPageBySlug(storeId, 'terms');
    expect((liveAfter!.blocks[0]!.props as { markdown: string }).markdown).toBe('v2');
  });

  it('unpublishPage clears the published pointer (rollback to offline) but keeps the draft', async () => {
    const { page } = await createPage(storeId, {
      slug: 'promo',
      title: 'Promo',
      blocks: [{ kind: 'rich-text', props: { markdown: 'live' } }],
    });
    await publishPage(storeId, page.id);
    expect(await getPageBySlug(storeId, 'promo')).not.toBeNull();

    const offline = await unpublishPage(storeId, page.id);
    expect(offline.publishedVersionId).toBeNull();
    expect(offline.status).toBe('draft');
    expect(offline.draftVersionId).not.toBeNull();
    expect(await getPageBySlug(storeId, 'promo')).toBeNull();
  });

  it('publishPage throws VersionNotFoundError when there is no draft', async () => {
    await migratorClient`
      INSERT INTO content_pages (store_id, slug, title, status)
      VALUES (${storeId}, 'empty', 'Empty', 'draft')
    `;
    const [row] = await migratorClient<{ id: string }[]>`
      SELECT id FROM content_pages WHERE store_id = ${storeId} AND slug = 'empty'
    `;
    await expect(publishPage(storeId, row!.id)).rejects.toBeInstanceOf(VersionNotFoundError);
  });

  it('listPages returns pages and filters by status', async () => {
    const all = await listPages(storeId);
    expect(all.length).toBeGreaterThan(0);
    const published = await listPages(storeId, { status: 'published' });
    expect(published.every(p => p.status === 'published')).toBe(true);
  });

  it('deletePage removes the page; subsequent admin read throws PageNotFoundError', async () => {
    const { page } = await createPage(storeId, { slug: 'temp', title: 'Temp' });
    await deletePage(storeId, page.id);
    await expect(getPageAdmin(storeId, page.id)).rejects.toBeInstanceOf(PageNotFoundError);
  });

  it('getPageAdmin on an unknown id throws PageNotFoundError', async () => {
    await expect(getPageAdmin(storeId, '00000000-0000-0000-0000-000000000000'))
      .rejects.toBeInstanceOf(PageNotFoundError);
  });
});
