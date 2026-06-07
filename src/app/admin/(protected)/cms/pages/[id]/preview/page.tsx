import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';

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
    <div className="wrap" style={{ maxWidth: 820 }}>
      <div className="between" style={{ marginBottom: 16 }}>
        <Link
          href={`/admin/cms/pages/${id}` as `/admin/cms/pages/${string}`}
          className="t-sub"
          style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}
        >
          <ArrowLeft className="h-4 w-4" />
          Back to editor
        </Link>
        <span className="statpill sp-draft">Draft preview</span>
      </div>

      <div style={{ marginBottom: 20 }}>
        <h2 className="h-md" style={{ fontFamily: 'var(--serif)' }}>{admin.page.title}</h2>
        <span className="t-sub">/{admin.page.slug}</span>
      </div>

      {target.seo ? (
        <div className="panel" style={{ marginBottom: 16 }}>
          <div className="panel-pad" style={{ fontSize: 13.5 }}>
            <p className="t-strong" style={{ marginBottom: 4 }}>SEO</p>
            {target.seo.title ? <p className="t-sub">Title: {target.seo.title}</p> : null}
            {target.seo.description ? <p className="t-sub">Description: {target.seo.description}</p> : null}
          </div>
        </div>
      ) : null}

      {blocks.length === 0 ? (
        <div className="panel">
          <p className="panel-pad t-sub" style={{ textAlign: 'center', padding: 40 }}>
            This draft has no blocks.
          </p>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {blocks.map((block, i) => {
            const kind = block.kind as keyof typeof BLOCK_SPECS;
            return (
              <section key={i} className="panel">
                <div className="panel-head">
                  <h3>{BLOCK_SPECS[kind].label}</h3>
                </div>
                <div className="panel-pad">
                  <pre
                    style={{
                      overflowX: 'auto',
                      borderRadius: 'var(--r-sm)',
                      background: 'var(--paper-2)',
                      padding: 12,
                      fontSize: 12,
                      margin: 0,
                    }}
                  >
                    {JSON.stringify(block.props, null, 2)}
                  </pre>
                </div>
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
    <div className="wrap" style={{ maxWidth: 560, textAlign: 'center', paddingBlock: 48 }}>
      <h2 className="h-md" style={{ fontFamily: 'var(--serif)', marginBottom: 8 }}>Preview unavailable</h2>
      <p className="t-sub" style={{ marginBottom: 20 }}>{reason}</p>
      <Link
        href={`/admin/cms/pages/${pageId}` as `/admin/cms/pages/${string}`}
        className="btn btn-ghost btn-sm"
      >
        Back to editor
      </Link>
    </div>
  );
}
