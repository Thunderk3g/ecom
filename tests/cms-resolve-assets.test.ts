/**
 * CMS image-ref resolution — `image.assetId` becomes a concrete `image.url` so
 * the block components (which only read `url`) actually render library assets.
 *
 * The asset lookup and store-slug lookup are mocked, so this is pure logic:
 * no DB, no network. deriveUrl comes from the real stub provider.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ContentBlock } from '@/modules/cms/blocks';
import { DERIVATIVE_PRESETS } from '@/modules/media/provider';

const rows = new Map<string, Record<string, unknown>>();

vi.mock('@/modules/media/store-slug', () => ({
  getStoreSlug: async () => 'acme',
}));

vi.mock('@/modules/media/assets', () => ({
  getAssetsByIds: async (_storeId: string, ids: string[]) =>
    new Map(ids.filter(id => rows.has(id)).map(id => [id, rows.get(id)])),
}));

const { resolveBlockAssets } = await import('@/modules/cms/resolve-assets');

const A = '11111111-1111-1111-1111-111111111111';
const B = '22222222-2222-2222-2222-222222222222';
const PENDING = '33333333-3333-3333-3333-333333333333';

function asset(id: string, over: Record<string, unknown> = {}) {
  return { id, key: `acme/${id}.png`, kind: 'image', meta: {}, ...over };
}

beforeEach(() => {
  rows.clear();
  rows.set(A, asset(A));
  rows.set(B, asset(B));
  rows.set(PENDING, asset(PENDING, { meta: { pending: true } }));
});

function imageOf(block: ContentBlock) {
  return block.props['image'] as { assetId?: string; url?: string; alt?: string } | undefined;
}

describe('resolveBlockAssets', () => {
  it('fills url from the asset library, at the preset for that block kind', async () => {
    const blocks: ContentBlock[] = [
      { kind: 'banner', props: { image: { assetId: A, alt: 'a' } } },
      { kind: 'hero', props: { title: 'T', image: { assetId: B } } },
    ];
    const [banner, hero] = await resolveBlockAssets('store', blocks);
    // banner + hero are full-bleed, so both use the 'hero' preset.
    expect(imageOf(banner!)?.url).toBe(`/media/stub/hero/${DERIVATIVE_PRESETS.hero}/acme/${A}.png`);
    expect(imageOf(hero!)?.url).toContain(`/acme/${B}.png`);
    // alt and assetId survive.
    expect(imageOf(banner!)?.alt).toBe('a');
    expect(imageOf(banner!)?.assetId).toBe(A);
  });

  it('never overwrites an explicit external url', async () => {
    const blocks: ContentBlock[] = [
      { kind: 'banner', props: { image: { assetId: A, url: 'https://cdn.example/x.png' } } },
    ];
    const [out] = await resolveBlockAssets('store', blocks);
    expect(imageOf(out!)?.url).toBe('https://cdn.example/x.png');
  });

  it('leaves url unset for unknown ids and for uploads that never finalized', async () => {
    const blocks: ContentBlock[] = [
      { kind: 'banner', props: { image: { assetId: '44444444-4444-4444-4444-444444444444' } } },
      { kind: 'banner', props: { image: { assetId: PENDING } } },
    ];
    const [missing, pending] = await resolveBlockAssets('store', blocks);
    expect(imageOf(missing!)?.url).toBeUndefined();
    expect(imageOf(pending!)?.url).toBeUndefined();
  });

  it('resolves refs nested inside two-column columns', async () => {
    const blocks: ContentBlock[] = [
      {
        kind: 'two-column',
        props: {
          left: [{ kind: 'banner', props: { image: { assetId: A } } }],
          right: [
            {
              kind: 'two-column',
              props: {
                left: [{ kind: 'hero', props: { title: 'deep', image: { assetId: B } } }],
                right: [],
              },
            },
          ],
        },
      },
    ];
    const [out] = await resolveBlockAssets('store', blocks);
    const left = (out!.props['left'] as ContentBlock[])[0]!;
    expect(imageOf(left)?.url).toContain(`/acme/${A}.png`);
    const innerRight = (out!.props['right'] as ContentBlock[])[0]!;
    const deep = (innerRight.props['left'] as ContentBlock[])[0]!;
    expect(imageOf(deep)?.url).toContain(`/acme/${B}.png`);
  });

  it('is a no-op (same array, no query) when nothing references an asset', async () => {
    const blocks: ContentBlock[] = [
      { kind: 'rich-text', props: { markdown: '# hi' } },
      { kind: 'banner', props: { image: { url: 'https://cdn.example/y.png' } } },
    ];
    const out = await resolveBlockAssets('store', blocks);
    expect(out).toBe(blocks);
  });
});
