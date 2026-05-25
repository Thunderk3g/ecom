/**
 * SVG sprite aggregator (SP-8, Task 10).
 *
 * `buildSpriteForStore(storeId)`:
 *   1. Lists every `kind = 'svg'` asset for the store (under withTenant / RLS).
 *   2. Fetches each SVG's raw bytes from the provider's public URL.
 *   3. Strips `<?xml …?>` and `<!DOCTYPE …>` declarations.
 *   4. Rewrites each root `<svg …>…</svg>` into `<symbol id="…">…</symbol>` keyed
 *      by `meta.iconName` (falling back to a slugified filename / key).
 *   5. Concatenates the symbols into a single `<svg style="display:none">…</svg>`
 *      aggregate.
 *   6. Writes the aggregate to `public/sprites/icons-<storeSlug>.svg` so the
 *      storefront `<Icon name="…"/>` component can `<use href="…#name"/>` it.
 *      File-system writes are ephemeral inside the runtime container but
 *      acceptable for v1; a follow-up can upload to R2 instead.
 *
 * The stub provider has no real object storage (PUT discards bytes), so when
 * an SVG can't be fetched we emit an empty `<symbol/>` placeholder rather than
 * failing the whole rebuild — dev environments can still see the wiring.
 */

import 'server-only';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { eq } from 'drizzle-orm';
import { withTenant } from '@/modules/tenant/with-tenant';
import { stores } from '@/db/schema/tenancy';
import { env } from '@/lib/env';
import { listAssets, type AssetRow } from './assets';

export interface BuildSpriteResult {
  /** Logical key for the artifact (matches the public route under /sprites/). */
  key: string;
  /** Public URL the storefront can <use href="…"> from. */
  url: string;
  /** Aggregate size in bytes. */
  bytes: number;
  /** Number of <symbol> entries packed in (one per svg asset). */
  symbols: number;
}

/**
 * Slugify a candidate name (icon name, filename, or asset key) into something
 * safe as an `id` value: lowercase, ascii alnum + hyphen, leading/trailing
 * hyphens trimmed. Empty input becomes `icon`.
 */
export function slugifyIconName(input: string): string {
  const stem = input.split('/').pop() ?? input;
  const noExt = stem.replace(/\.svg$/i, '');
  const slug = noExt
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug || 'icon';
}

/**
 * Strip `<?xml …?>` and `<!DOCTYPE …>` declarations; collapse leading whitespace.
 * Comments are kept (they're usually license headers — cheap to retain).
 */
function stripDeclarations(svg: string): string {
  return svg
    .replace(/<\?xml[\s\S]*?\?>/g, '')
    .replace(/<!DOCTYPE[\s\S]*?>/i, '')
    .trim();
}

/**
 * Convert a single SVG document into a `<symbol id="…">…</symbol>` fragment.
 * Pulls the root `<svg>` tag's `viewBox` (and `width`/`height` as fallback) onto
 * the symbol so consumers can scale via CSS without re-deriving the box.
 */
export function svgToSymbol(svg: string, id: string): string {
  const cleaned = stripDeclarations(svg);
  const openMatch = cleaned.match(/<svg\b([^>]*)>/i);
  if (!openMatch) return `<symbol id="${escapeAttr(id)}"></symbol>`;
  const attrs = openMatch[1] ?? '';
  const inner = cleaned
    .slice(openMatch[0].length)
    .replace(/<\/svg\s*>\s*$/i, '')
    .trim();

  const viewBox = matchAttr(attrs, 'viewBox');
  const width = matchAttr(attrs, 'width');
  const height = matchAttr(attrs, 'height');

  const symbolAttrs = [`id="${escapeAttr(id)}"`];
  if (viewBox) symbolAttrs.push(`viewBox="${escapeAttr(viewBox)}"`);
  else if (width && height) symbolAttrs.push(`viewBox="0 0 ${escapeAttr(width)} ${escapeAttr(height)}"`);

  return `<symbol ${symbolAttrs.join(' ')}>${inner}</symbol>`;
}

function matchAttr(attrs: string, name: string): string | null {
  const re = new RegExp(`\\b${name}\\s*=\\s*"([^"]*)"`, 'i');
  const m = attrs.match(re);
  return m ? (m[1] ?? null) : null;
}

function escapeAttr(v: string): string {
  return v.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

async function getStoreSlug(storeId: string): Promise<string> {
  return withTenant(storeId, async tx => {
    const [row] = await tx.select({ slug: stores.slug }).from(stores).where(eq(stores.id, storeId));
    return row?.slug ?? 'store';
  });
}

/**
 * Resolve a public URL for an SVG asset by joining the configured R2 public
 * base with the asset's content-addressed key. Returns null when the deployment
 * isn't using the R2 provider (e.g. stub in dev/tests).
 */
function publicUrlFor(asset: AssetRow): string | null {
  const base = env.R2_PUBLIC_BASE_URL;
  if (!base) return null;
  return `${base.replace(/\/$/, '')}/${asset.key}`;
}

/** Read every SVG asset for the store under RLS, paginating through all pages. */
async function loadAllSvgAssets(storeId: string): Promise<AssetRow[]> {
  const all: AssetRow[] = [];
  let cursor: string | undefined;
  // Cap loop iterations defensively in case of cursor bugs.
  for (let i = 0; i < 100; i += 1) {
    const page = await listAssets(storeId, { kind: 'svg', limit: 200, cursor });
    all.push(...page.items);
    if (!page.nextCursor) break;
    cursor = page.nextCursor;
  }
  return all;
}

/**
 * Fetch the SVG bytes for an asset. Returns null if no public URL is available
 * (stub provider) or the fetch fails — the caller emits an empty placeholder.
 */
async function fetchSvgBody(asset: AssetRow): Promise<string | null> {
  const url = publicUrlFor(asset);
  if (!url) return null;
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    return await res.text();
  } catch {
    return null;
  }
}

/**
 * Pick the symbol id for an asset: explicit `meta.iconName` wins; otherwise
 * slugify the original filename; otherwise slugify the object key.
 */
function iconIdFor(asset: AssetRow): string {
  const explicit = typeof asset.meta.iconName === 'string' ? asset.meta.iconName : null;
  if (explicit) return slugifyIconName(explicit);
  const filename = typeof asset.meta.originalFilename === 'string' ? asset.meta.originalFilename : null;
  if (filename) return slugifyIconName(filename);
  return slugifyIconName(asset.key);
}

/** Deduplicate ids by appending `-2`, `-3`, … so the sprite stays valid HTML. */
function uniqueId(taken: Set<string>, candidate: string): string {
  if (!taken.has(candidate)) {
    taken.add(candidate);
    return candidate;
  }
  for (let n = 2; n < 10_000; n += 1) {
    const next = `${candidate}-${n}`;
    if (!taken.has(next)) {
      taken.add(next);
      return next;
    }
  }
  // Pathological fallback — shouldn't be reachable in practice.
  const fallback = `${candidate}-${taken.size}`;
  taken.add(fallback);
  return fallback;
}

/**
 * Build (or rebuild) the SVG sprite for a store and persist it under
 * `public/sprites/icons-<storeSlug>.svg`.
 */
export async function buildSpriteForStore(storeId: string): Promise<BuildSpriteResult> {
  const [storeSlug, svgAssets] = await Promise.all([
    getStoreSlug(storeId),
    loadAllSvgAssets(storeId),
  ]);

  const taken = new Set<string>();
  const symbols: string[] = [];
  for (const asset of svgAssets) {
    const id = uniqueId(taken, iconIdFor(asset));
    const body = await fetchSvgBody(asset);
    if (body === null) {
      // Provider couldn't return the bytes (stub or fetch failure). Emit an
      // empty placeholder so the id is still usable as a hook in the storefront.
      symbols.push(`<symbol id="${escapeAttr(id)}"></symbol>`);
      continue;
    }
    symbols.push(svgToSymbol(body, id));
  }

  const aggregate =
    '<svg xmlns="http://www.w3.org/2000/svg" style="display:none" aria-hidden="true">' +
    symbols.join('') +
    '</svg>';

  const fileName = `icons-${storeSlug}.svg`;
  const key = `sprites/${fileName}`;
  const publicDir = path.join(process.cwd(), 'public', 'sprites');
  const outputPath = path.join(publicDir, fileName);

  await mkdir(publicDir, { recursive: true });
  await writeFile(outputPath, aggregate, 'utf8');

  return {
    key,
    url: `/sprites/${fileName}`,
    bytes: Buffer.byteLength(aggregate, 'utf8'),
    symbols: symbols.length,
  };
}
