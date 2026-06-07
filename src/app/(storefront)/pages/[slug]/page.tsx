import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { getPageBySlug } from '@/modules/cms/pages';
import { CmsBlockRenderer } from '@/components/storefront/CmsBlockRenderer';
import { getStoreContext } from '../../_lib/context';

/**
 * Marketing pages route. Renders any published CMS page by slug through the
 * shared block registry. A page is considered live only when it has a
 * `publishedVersionId`; drafts and archived pages 404 here (admin preview is
 * served from `/admin/cms/pages/[id]/preview`).
 *
 * Per-tenant content + frequent publishes → render dynamically; cache busts
 * on publish via `revalidatePath('/pages/<slug>')` (Task 21).
 */
export const dynamic = 'force-dynamic';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const { storeId } = await getStoreContext();
  const page = await getPageBySlug(storeId, slug);
  if (!page) return { title: 'Page' };

  const seoTitle = page.seo?.title ?? page.page.title;
  const meta: Metadata = { title: seoTitle };
  if (page.seo?.description) meta.description = page.seo.description;
  if (page.seo?.keywords && page.seo.keywords.length > 0) {
    meta.keywords = page.seo.keywords;
  }
  return meta;
}

export default async function CmsMarketingPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const { storeId, config } = await getStoreContext();

  const page = await getPageBySlug(storeId, slug);
  // getPageBySlug returns null when the page is missing OR has no published
  // version (drafts/archived) — both are 404 to anonymous visitors.
  if (!page) notFound();

  // Plume scope: blocks render full-bleed sections that manage their own
  // `.wrap`/`.container` width, so we only provide the page-level rhythm and
  // let the Plume tokens (serif headings, `.lede`) inherit. The block markup
  // and the registry dispatch are untouched.
  return (
    <main className="cms-page section">
      <CmsBlockRenderer storeId={storeId} config={config} blocks={page.blocks} />
    </main>
  );
}
