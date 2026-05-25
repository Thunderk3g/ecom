import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { getPageAdmin } from '@/modules/cms/pages';
import { signPreviewToken } from '@/modules/cms/preview';
import { isBlockKind } from '@/modules/cms/blocks';
import { PageNotFoundError } from '@/modules/cms/errors';
import {
  getCmsAdminContext,
  assertPermission,
  AdminContextError,
} from '../../_lib/admin-context';
import { BlockBuilder, type EditorBlock } from '../../_components/BlockBuilder';

export const dynamic = 'force-dynamic';

type Params = Promise<{ id: string }>;

function toEditorBlocks(raw: unknown[]): EditorBlock[] {
  const out: EditorBlock[] = [];
  for (const item of raw) {
    if (typeof item !== 'object' || item === null) continue;
    const rec = item as Record<string, unknown>;
    if (!isBlockKind(rec.kind)) continue;
    const props =
      typeof rec.props === 'object' && rec.props !== null && !Array.isArray(rec.props)
        ? (rec.props as Record<string, unknown>)
        : {};
    out.push({ kind: rec.kind, props });
  }
  return out;
}

export default async function CmsPageEditor({ params }: { params: Params }) {
  let ctx;
  try {
    ctx = await getCmsAdminContext();
    assertPermission(ctx, 'cms:read');
  } catch (err) {
    if (err instanceof AdminContextError) redirect('/admin/login');
    throw err;
  }

  const { id } = await params;

  let admin;
  try {
    admin = await getPageAdmin(ctx.storeId, id);
  } catch (err) {
    if (err instanceof PageNotFoundError) notFound();
    throw err;
  }

  const draftVersion = admin.draft;
  const blocks = draftVersion ? toEditorBlocks(draftVersion.blocks ?? []) : [];

  // Build a preview URL bound to the draft version (5-min signed token).
  const previewHref =
    draftVersion !== null
      ? `/admin/cms/pages/${id}/preview?token=${encodeURIComponent(
          signPreviewToken(admin.page.id, draftVersion.id),
        )}`
      : null;

  return (
    <div className="space-y-6">
      <Button asChild variant="ghost" size="sm" className="-ml-2">
        <Link href="/admin/cms/pages">
          <ArrowLeft className="mr-1 h-4 w-4" />
          All pages
        </Link>
      </Button>

      <BlockBuilder
        pageId={admin.page.id}
        slug={admin.page.slug}
        title={admin.page.title}
        status={admin.page.status}
        initialBlocks={blocks}
        hasPublishedVersion={admin.page.publishedVersionId !== null}
        previewHref={previewHref}
      />
    </div>
  );
}
