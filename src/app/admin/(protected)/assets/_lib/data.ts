import 'server-only';
import { eq } from 'drizzle-orm';
import { withTenant } from '@/modules/tenant/with-tenant';
import { stores } from '@/db/schema/tenancy';
import {
  listAssets,
  listDerivatives,
  listTags,
  type AssetRow,
  type ListAssetsOptions,
} from '@/modules/media/assets';
import { getMediaProvider, type AssetKind } from '@/modules/media/provider';

/** An asset enriched with a best-effort thumbnail URL for the gallery grid. */
export interface GalleryAsset extends AssetRow {
  /** URL for the smallest available rendition (a real derivative if present,
   *  otherwise a provider-derived 'thumb' URL). null for non-image kinds. */
  thumbUrl: string | null;
  pending: boolean;
  tags: string[];
}

export interface GalleryListResult {
  items: GalleryAsset[];
  nextCursor: string | null;
  storeSlug: string;
}

async function getStoreSlug(storeId: string): Promise<string> {
  return withTenant(storeId, async tx => {
    const [row] = await tx.select({ slug: stores.slug }).from(stores).where(eq(stores.id, storeId));
    return row?.slug ?? 'store';
  });
}

function thumbFor(asset: AssetRow, storeSlug: string): string | null {
  if (asset.kind !== 'image' && asset.kind !== 'svg') return null;
  if (asset.kind === 'svg') return null; // svg has no raster derivatives; rendered separately
  try {
    return getMediaProvider().deriveUrl(
      { storeSlug, key: asset.key, kind: asset.kind },
      'thumb',
    );
  } catch {
    return null;
  }
}

/** Cursor-paginated gallery listing with thumbnail URLs resolved. */
export async function loadGallery(
  storeId: string,
  opts: ListAssetsOptions,
): Promise<GalleryListResult> {
  const [storeSlug, page] = await Promise.all([
    getStoreSlug(storeId),
    listAssets(storeId, opts),
  ]);
  const tagLists = await Promise.all(page.items.map(a => listTags(storeId, a.id)));
  const items: GalleryAsset[] = page.items.map((a, i) => ({
    ...a,
    thumbUrl: thumbFor(a, storeSlug),
    pending: a.meta.pending === true,
    tags: tagLists[i] ?? [],
  }));
  return { items, nextCursor: page.nextCursor, storeSlug };
}

export interface AssetDetail {
  asset: AssetRow;
  tags: string[];
  derivatives: { preset: string; url: string; width: number | null; height: number | null }[];
  storeSlug: string;
}

export async function loadAssetDetail(storeId: string, assetId: string): Promise<AssetDetail> {
  const { getAsset } = await import('@/modules/media/assets');
  const [storeSlug, asset, tags, derivatives] = await Promise.all([
    getStoreSlug(storeId),
    getAsset(storeId, assetId),
    listTags(storeId, assetId),
    listDerivatives(storeId, assetId),
  ]);
  return {
    asset,
    tags,
    storeSlug,
    derivatives: derivatives.map(d => ({
      preset: d.preset,
      url: d.url,
      width: d.width,
      height: d.height,
    })),
  };
}

export const ASSET_KINDS: readonly AssetKind[] = ['image', 'svg', 'doc'];
