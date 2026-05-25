import Link from 'next/link';
import { redirect } from 'next/navigation';

import { Button } from '@/components/ui/button';
import { getAssetsAdminContext, assertPermission, AdminContextError } from './_lib/admin-context';
import { loadGallery } from './_lib/data';
import { AssetGrid, type GridAsset } from './_components/AssetGrid';
import { AssetFilters } from './_components/AssetFilters';
import { UploadDialog } from './_components/UploadDialog';
import type { AssetKind } from '@/modules/media/provider';

export const dynamic = 'force-dynamic';

type SearchParams = Promise<{ kind?: string; tag?: string; after?: string }>;

function parseKind(value: string | undefined): AssetKind | undefined {
  if (value === 'image' || value === 'svg' || value === 'doc') return value;
  return undefined;
}

export default async function AssetsPage({ searchParams }: { searchParams: SearchParams }) {
  let ctx;
  try {
    ctx = await getAssetsAdminContext();
    assertPermission(ctx, 'media:read');
  } catch (err) {
    if (err instanceof AdminContextError) redirect('/admin/login');
    throw err;
  }

  const sp = await searchParams;
  const kind = parseKind(sp.kind);
  const tag = sp.tag?.trim() || undefined;
  const after = sp.after || undefined;

  const { items, nextCursor } = await loadGallery(ctx.storeId, { kind, tag, cursor: after, limit: 48 });

  const grid: GridAsset[] = items.map(a => ({
    id: a.id,
    kind: a.kind,
    mime: a.mime,
    bytes: a.bytes,
    width: a.width,
    height: a.height,
    key: a.key,
    originalFilename: typeof a.meta.originalFilename === 'string' ? a.meta.originalFilename : null,
    thumbUrl: a.thumbUrl,
    pending: a.pending,
    tags: a.tags,
    createdAt: a.createdAt.toISOString(),
  }));

  const nextHref = nextCursor
    ? buildNextHref({ kind: sp.kind, tag: sp.tag, after: nextCursor })
    : null;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Assets</h1>
          <p className="text-muted-foreground">Browse, upload, and manage media for this store.</p>
        </div>
        <UploadDialog csrfToken={ctx.csrfToken} />
      </div>

      <AssetFilters />

      <AssetGrid assets={grid} />

      {nextHref ? (
        <div className="flex justify-center">
          <Button asChild variant="outline">
            <Link href={nextHref}>Load more</Link>
          </Button>
        </div>
      ) : null}
    </div>
  );
}

function buildNextHref(params: { kind?: string; tag?: string; after: string }): `/admin/assets?${string}` {
  const sp = new URLSearchParams();
  if (params.kind) sp.set('kind', params.kind);
  if (params.tag) sp.set('tag', params.tag);
  sp.set('after', params.after);
  return `/admin/assets?${sp.toString()}`;
}
