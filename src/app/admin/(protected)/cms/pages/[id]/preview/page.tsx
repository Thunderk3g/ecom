import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { getPageAdmin, type ContentVersionRow } from '@/modules/cms/pages';
import { verifyPreviewToken } from '@/modules/cms/preview';
import { isBlockKind } from '@/modules/cms/blocks';
import { PageNotFoundError } from '@/modules/cms/errors';
import { BLOCK_SPECS } from '../../../_lib/block-fields';
import {
  getCmsAdminContext,
  assertPermission,
  AdminContextError,
} from '../../../_lib/admin-context';

export const dynamic = 'force-dynamic';

type Params = Promise<{ id: string }>;
type SearchParams = Promise<{ token?: string }>;

/**
 * Draft preview. Verifies a short-lived signed token bound to (pageId,
 * versionId), then renders a lightweight dump of the draft version's blocks.
 * Full storefront visual parity is out of scope here (storefront renderer is
 * SP-7 Stream C) — this confirms the saved draft structure before publishing.
 */
export default async function CmsPagePreview({
  params,
  searchParams,
}: {
  params: Params;
  searchParams: SearchParams;
}) {
  let ctx;
  try {
    ctx = await getCmsAdminContext();
    assertPermission(ctx, 'cms:read');
  } catch (err) {
    if (err instanceof AdminContextError) redirect('/admin/login');
    throw err;
  }

  const { id } = await params;
  const { token } = await searchParams;

  if (!token) return <PreviewError reason="No preview token supplied." pageId={id} />;
  const verified = verifyPreviewToken(token);
  if (!verified.ok) {
    const msg =
      verified.reason === 'expired'
        ? 'This preview link has expired. Re-open Preview from the editor.'
        : 'This preview link is invalid.';
    return <PreviewError reason={msg} pageId={id} />;
  }
  if (verified.payload.pageId !== id) {
    return <PreviewError reason="Preview token does not match this page." pageId={id} />;
  }

  let admin;
  try {
    admin = await getPageAdmin(ctx.storeId, id);
  } catch (err) {
    if (err instanceof PageNotFoundError) notFound();
    throw err;
  }

  // Resolve the version the token is bound to (draft or published).
  const target: ContentVersionRow | null =
    admin.draft?.id === verified.payload.versionId
      ? admin.draft
      : admin.published?.id === verified.payload.versionId
        ? admin.published
        : null;

  if (!target) return <PreviewError reason="The previewed version no longer exists." pageId={id} />;

  const blocks = (target.blocks ?? []).filter(
    (b): b is { kind: string; props: Record<string, unknown> } =>
      typeof b === 'object' && b !== null && isBlockKind((b as { kind?: unknown }).kind),
  );

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div className="flex items-center justify-between">
        <Button asChild variant="ghost" size="sm" className="-ml-2">
          <Link href={`/admin/cms/pages/${id}` as `/admin/cms/pages/${string}`}>
            <ArrowLeft className="mr-1 h-4 w-4" />
            Back to editor
          </Link>
        </Button>
        <Badge variant="outline">Draft preview</Badge>
      </div>

      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{admin.page.title}</h1>
        <p className="text-muted-foreground">/{admin.page.slug}</p>
      </div>

      {target.seo ? (
        <div className="rounded-lg border bg-muted/40 p-4 text-sm">
          <p className="font-medium">SEO</p>
          {target.seo.title ? <p>Title: {target.seo.title}</p> : null}
          {target.seo.description ? <p>Description: {target.seo.description}</p> : null}
        </div>
      ) : null}

      {blocks.length === 0 ? (
        <p className="rounded-lg border border-dashed p-10 text-center text-muted-foreground">
          This draft has no blocks.
        </p>
      ) : (
        <div className="space-y-4">
          {blocks.map((block, i) => {
            const kind = block.kind as keyof typeof BLOCK_SPECS;
            return (
              <section key={i} className="rounded-lg border bg-background p-4">
                <header className="mb-2 flex items-center gap-2">
                  <Badge variant="secondary">{BLOCK_SPECS[kind].label}</Badge>
                </header>
                <pre className="overflow-x-auto rounded bg-muted p-3 text-xs">
                  {JSON.stringify(block.props, null, 2)}
                </pre>
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}

function PreviewError({ reason, pageId }: { reason: string; pageId: string }) {
  return (
    <div className="mx-auto max-w-xl space-y-4 py-12 text-center">
      <h1 className="text-xl font-semibold">Preview unavailable</h1>
      <p className="text-muted-foreground">{reason}</p>
      <Button asChild variant="outline">
        <Link href={`/admin/cms/pages/${pageId}` as `/admin/cms/pages/${string}`}>Back to editor</Link>
      </Button>
    </div>
  );
}
