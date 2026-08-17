/**
 * CMS image-reference resolution.
 *
 * A block's image ref is `{ assetId? , url?, alt? }` (see `imageRefSchema` in
 * ./blocks.ts): `assetId` points at the SP-8 asset library, `url` is the escape
 * hatch for externally hosted images. The block components only ever read
 * `image.url` — so until this resolver existed, choosing a library asset in the
 * CMS stored a valid `assetId` and then silently rendered nothing.
 *
 * This fills in `url` from the asset library for every `assetId` ref, once, at
 * the dispatcher — so individual block components stay dumb and any future
 * image-bearing block gets the behaviour for free. All refs across the page
 * (including nested `two-column` columns) resolve in a single query.
 *
 * Failure is always "no image", never a broken page: unknown ids, uploads that
 * never finalized, and an unconfigured MediaProvider all leave `url` unset so
 * the component falls back exactly as it does for an image-less block.
 */

import 'server-only';
import { logger } from '@/lib/logger';
import { getAssetsByIds, type AssetRow } from '@/modules/media/assets';
import { getMediaProvider, type DerivativePreset } from '@/modules/media/provider';
import { getStoreSlug } from '@/modules/media/store-slug';
import type { ContentBlock } from './blocks';

/** Full-bleed blocks deserve the largest rendition; anything else is content-width. */
const PRESET_BY_KIND: Partial<Record<ContentBlock['kind'], DerivativePreset>> = {
  hero: 'hero',
  banner: 'hero',
};
const DEFAULT_PRESET: DerivativePreset = 'detail';

interface ImageRef {
  assetId?: string;
  url?: string;
  alt?: string;
}

function imageRefOf(props: Record<string, unknown>): ImageRef | null {
  const img = props['image'];
  if (typeof img !== 'object' || img === null || Array.isArray(img)) return null;
  return img as ImageRef;
}

/** Columns of a validated `two-column` block are themselves ContentBlock[]. */
function columnOf(props: Record<string, unknown>, side: 'left' | 'right'): ContentBlock[] {
  const col = props[side];
  return Array.isArray(col) ? (col as ContentBlock[]) : [];
}

function collectAssetIds(blocks: ContentBlock[], out: string[]): void {
  for (const block of blocks) {
    const ref = imageRefOf(block.props);
    // An explicit `url` wins — it means the author deliberately pointed at an
    // external image, so we must not overwrite it.
    if (ref?.assetId && !ref.url) out.push(ref.assetId);
    if (block.kind === 'two-column') {
      collectAssetIds(columnOf(block.props, 'left'), out);
      collectAssetIds(columnOf(block.props, 'right'), out);
    }
  }
}

function urlFor(asset: AssetRow, storeSlug: string, preset: DerivativePreset): string | null {
  // A pending row is an upload that never finalized — there are no bytes behind
  // the key, so a URL would render as a broken image.
  if (asset.meta.pending === true) return null;
  try {
    return getMediaProvider().deriveUrl(
      { storeSlug, key: asset.key, kind: asset.kind },
      preset,
    );
  } catch (err) {
    logger.warn({ err, assetId: asset.id }, 'cms: could not derive asset url');
    return null;
  }
}

function rewrite(
  blocks: ContentBlock[],
  assets: Map<string, AssetRow>,
  storeSlug: string,
): ContentBlock[] {
  return blocks.map(block => {
    let props = block.props;

    const ref = imageRefOf(props);
    if (ref?.assetId && !ref.url) {
      const asset = assets.get(ref.assetId);
      const url = asset
        ? urlFor(asset, storeSlug, PRESET_BY_KIND[block.kind] ?? DEFAULT_PRESET)
        : null;
      if (url) props = { ...props, image: { ...ref, url } };
    }

    if (block.kind === 'two-column') {
      props = {
        ...props,
        left: rewrite(columnOf(props, 'left'), assets, storeSlug),
        right: rewrite(columnOf(props, 'right'), assets, storeSlug),
      };
    }

    return props === block.props ? block : { ...block, props };
  });
}

/**
 * Return `blocks` with every `image.assetId` reference resolved to a concrete
 * `image.url`. Blocks with no unresolved refs are returned as-is (same object),
 * and the whole thing short-circuits without a query when a page has none.
 */
export async function resolveBlockAssets(
  storeId: string,
  blocks: ContentBlock[],
): Promise<ContentBlock[]> {
  const ids: string[] = [];
  collectAssetIds(blocks, ids);
  if (ids.length === 0) return blocks;

  const [storeSlug, assets] = await Promise.all([
    getStoreSlug(storeId),
    getAssetsByIds(storeId, ids),
  ]);
  return rewrite(blocks, assets, storeSlug);
}
