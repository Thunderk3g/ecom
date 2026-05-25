import { and, eq, sql, type SQL } from 'drizzle-orm';
import { withTenant } from '@/modules/tenant/with-tenant';
import { contentPages, contentVersions } from '@/db/schema/cms';
import { validateBlocks, type ContentBlock } from './blocks';
import { PageNotFoundError, SlugConflictError, VersionNotFoundError } from './errors';

export type ContentPageRow = typeof contentPages.$inferSelect;
export type ContentVersionRow = typeof contentVersions.$inferSelect;
export type PageStatus = ContentPageRow['status'];
export type PageSeo = { title?: string; description?: string; keywords?: string[] };

export type PageSummary = ContentPageRow;

/** Public (storefront) view: the page plus its PUBLISHED block tree + SEO. */
export type PublishedPage = {
  page: ContentPageRow;
  version: ContentVersionRow;
  blocks: ContentBlock[];
  seo: PageSeo | null;
};

/** Admin view: the page plus both draft and published versions (either may be null). */
export type AdminPage = {
  page: ContentPageRow;
  draft: ContentVersionRow | null;
  published: ContentVersionRow | null;
};

export type CreatePageInput = {
  slug: string;
  title: string;
  /** Optional initial draft content. Defaults to an empty block list. */
  blocks?: unknown[];
  seo?: PageSeo | null;
  createdBy?: string | null;
};

export type UpdateDraftInput = {
  blocks?: unknown[];
  seo?: PageSeo | null;
  title?: string;
  createdBy?: string | null;
};

export type ListPagesOptions = {
  status?: PageStatus;
};

// ---------- Reads ----------

export async function listPages(
  storeId: string,
  opts: ListPagesOptions = {},
): Promise<PageSummary[]> {
  return withTenant(storeId, async tx => {
    const conds: SQL[] = [];
    if (opts.status) conds.push(eq(contentPages.status, opts.status));
    const base = tx.select().from(contentPages);
    const q = conds.length ? base.where(and(...conds)) : base;
    return q.orderBy(sql`${contentPages.updatedAt} DESC`, sql`${contentPages.id} DESC`);
  });
}

/**
 * Storefront read: returns the page and its PUBLISHED version blocks. Returns
 * null when the page does not exist or has no published version (not live).
 */
export async function getPageBySlug(
  storeId: string,
  slug: string,
): Promise<PublishedPage | null> {
  return withTenant(storeId, async tx => {
    const [page] = await tx
      .select()
      .from(contentPages)
      .where(eq(contentPages.slug, slug))
      .limit(1);
    if (!page || !page.publishedVersionId) return null;

    const [version] = await tx
      .select()
      .from(contentVersions)
      .where(eq(contentVersions.id, page.publishedVersionId))
      .limit(1);
    if (!version) return null;

    return {
      page,
      version,
      blocks: (version.blocks ?? []) as ContentBlock[],
      seo: version.seo ?? null,
    };
  });
}

/** Admin read by page id: returns the page with its draft + published versions. */
export async function getPageAdmin(storeId: string, pageId: string): Promise<AdminPage> {
  return withTenant(storeId, async tx => {
    const [page] = await tx
      .select()
      .from(contentPages)
      .where(eq(contentPages.id, pageId))
      .limit(1);
    if (!page) throw new PageNotFoundError(pageId);

    const draft = page.draftVersionId
      ? (await tx.select().from(contentVersions).where(eq(contentVersions.id, page.draftVersionId)).limit(1))[0] ?? null
      : null;
    const published = page.publishedVersionId
      ? (await tx.select().from(contentVersions).where(eq(contentVersions.id, page.publishedVersionId)).limit(1))[0] ?? null
      : null;

    return { page, draft, published };
  });
}

// ---------- Writes ----------

/**
 * Create a page in draft status with an initial draft version. The page is not
 * live until publishPage() is called.
 */
export async function createPage(storeId: string, input: CreatePageInput): Promise<AdminPage> {
  const blocks = validateBlocks(input.blocks ?? []);

  return withTenant(storeId, async tx => {
    const dupe = await tx
      .select({ id: contentPages.id })
      .from(contentPages)
      .where(eq(contentPages.slug, input.slug))
      .limit(1);
    if (dupe[0]) throw new SlugConflictError(input.slug);

    const [page] = await tx
      .insert(contentPages)
      .values({
        storeId,
        slug: input.slug,
        title: input.title,
        status: 'draft',
      })
      .returning();
    if (!page) throw new Error('createPage: insert returned no page row');

    const [version] = await tx
      .insert(contentVersions)
      .values({
        storeId,
        pageId: page.id,
        blocks,
        seo: input.seo ?? null,
        createdBy: input.createdBy ?? null,
      })
      .returning();
    if (!version) throw new Error('createPage: insert returned no version row');

    const [updated] = await tx
      .update(contentPages)
      .set({ draftVersionId: version.id, updatedAt: sql`now()` })
      .where(eq(contentPages.id, page.id))
      .returning();

    return { page: updated ?? page, draft: version, published: null };
  });
}

/**
 * Create a NEW draft version for the page (immutable versioning) and point the
 * page's draft_version_id at it. The previously published version is untouched
 * so the storefront keeps serving it until publish.
 */
export async function updateDraft(
  storeId: string,
  pageId: string,
  input: UpdateDraftInput,
): Promise<ContentVersionRow> {
  const blocks = validateBlocks(input.blocks ?? []);

  return withTenant(storeId, async tx => {
    const [page] = await tx
      .select()
      .from(contentPages)
      .where(eq(contentPages.id, pageId))
      .limit(1);
    if (!page) throw new PageNotFoundError(pageId);

    const [version] = await tx
      .insert(contentVersions)
      .values({
        storeId,
        pageId: page.id,
        blocks,
        seo: input.seo ?? null,
        createdBy: input.createdBy ?? null,
      })
      .returning();
    if (!version) throw new Error('updateDraft: insert returned no version row');

    await tx
      .update(contentPages)
      .set({
        draftVersionId: version.id,
        ...(input.title !== undefined ? { title: input.title } : {}),
        updatedAt: sql`now()`,
      })
      .where(eq(contentPages.id, page.id));

    return version;
  });
}

/**
 * Transactional pointer swap: set published_version_id := draft_version_id and
 * mark the page 'published'. Idempotent when there is nothing new to publish.
 * Throws if there is no draft to publish.
 */
export async function publishPage(storeId: string, pageId: string): Promise<ContentPageRow> {
  return withTenant(storeId, async tx => {
    const [page] = await tx
      .select()
      .from(contentPages)
      .where(eq(contentPages.id, pageId))
      .limit(1);
    if (!page) throw new PageNotFoundError(pageId);
    if (!page.draftVersionId) throw new VersionNotFoundError(`draft for page:${pageId}`);

    // Defensive: ensure the draft version still exists in this tenant.
    const [draft] = await tx
      .select({ id: contentVersions.id })
      .from(contentVersions)
      .where(eq(contentVersions.id, page.draftVersionId))
      .limit(1);
    if (!draft) throw new VersionNotFoundError(page.draftVersionId);

    const [updated] = await tx
      .update(contentPages)
      .set({
        publishedVersionId: page.draftVersionId,
        status: 'published',
        updatedAt: sql`now()`,
      })
      .where(eq(contentPages.id, page.id))
      .returning();
    if (!updated) throw new PageNotFoundError(pageId);
    return updated;
  });
}

/**
 * Take a page offline: clears published_version_id and marks it 'draft'. The
 * draft pointer (work in progress) is preserved. Throws if the page is missing.
 */
export async function unpublishPage(storeId: string, pageId: string): Promise<ContentPageRow> {
  return withTenant(storeId, async tx => {
    const [updated] = await tx
      .update(contentPages)
      .set({ publishedVersionId: null, status: 'draft', updatedAt: sql`now()` })
      .where(eq(contentPages.id, pageId))
      .returning();
    if (!updated) throw new PageNotFoundError(pageId);
    return updated;
  });
}

/** Hard-delete a page (and its versions via FK cascade). */
export async function deletePage(storeId: string, pageId: string): Promise<void> {
  await withTenant(storeId, async tx => {
    const deleted = await tx
      .delete(contentPages)
      .where(eq(contentPages.id, pageId))
      .returning({ id: contentPages.id });
    if (!deleted[0]) throw new PageNotFoundError(pageId);
  });
}
