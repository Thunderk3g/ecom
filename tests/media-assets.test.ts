/**
 * SP-8 assets module service — create, get, list (kind/tag filters + cursor),
 * tags, derivative recording, and RLS isolation across two stores. Real
 * Postgres via the tenant-scoped app_user; no network.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { resetAndMigrate } from './_setup/db';
import { migratorClient } from '@/db/client';
import {
  createAssetRecord,
  getAsset,
  listAssets,
  attachTag,
  removeTag,
  listTags,
  recordDerivative,
  listDerivatives,
} from '@/modules/media/assets';
import { AssetNotFoundError } from '@/modules/media/errors';

async function createStore(slug: string): Promise<string> {
  const rows = await migratorClient<{ id: string }[]>`
    INSERT INTO stores (slug, name) VALUES (${slug}, ${slug}) RETURNING id
  `;
  return rows[0]!.id;
}

describe('assets module service', () => {
  let storeA: string;
  let storeB: string;

  beforeAll(async () => {
    await resetAndMigrate();
    storeA = await createStore('media-a');
    storeB = await createStore('media-b');
  });

  afterAll(async () => {
    await migratorClient.end();
  });

  it('createAssetRecord persists and getAsset round-trips it', async () => {
    const created = await createAssetRecord(storeA, {
      key: 'media-a/one.png',
      kind: 'image',
      mime: 'image/png',
      bytes: 1234,
      width: 100,
      height: 80,
      checksum: 'sum1',
      meta: { originalFilename: 'one.png' },
    });
    expect(created.storeId).toBe(storeA);
    expect(created.kind).toBe('image');

    const fetched = await getAsset(storeA, created.id);
    expect(fetched.key).toBe('media-a/one.png');
    expect(fetched.bytes).toBe(1234);
    expect(fetched.meta.originalFilename).toBe('one.png');
  });

  it('createAssetRecord honors a caller-provided id', async () => {
    const id = crypto.randomUUID();
    const created = await createAssetRecord(storeA, {
      id,
      key: 'media-a/withid.svg',
      kind: 'svg',
      mime: 'image/svg+xml',
    });
    expect(created.id).toBe(id);
  });

  it('listAssets filters by kind and paginates with a cursor', async () => {
    // Three more image assets in store A.
    for (let i = 0; i < 3; i++) {
      await createAssetRecord(storeA, {
        key: `media-a/img-${i}.webp`,
        kind: 'image',
        mime: 'image/webp',
      });
    }
    const page1 = await listAssets(storeA, { kind: 'image', limit: 2 });
    expect(page1.items.length).toBe(2);
    expect(page1.items.every(a => a.kind === 'image')).toBe(true);
    expect(page1.nextCursor).not.toBeNull();

    const page2 = await listAssets(storeA, { kind: 'image', limit: 2, cursor: page1.nextCursor! });
    const ids1 = new Set(page1.items.map(a => a.id));
    expect(page2.items.every(a => !ids1.has(a.id))).toBe(true);

    // svg filter excludes images.
    const svgs = await listAssets(storeA, { kind: 'svg', limit: 50 });
    expect(svgs.items.every(a => a.kind === 'svg')).toBe(true);
  });

  it('attachTag / listTags / removeTag are idempotent and filterable', async () => {
    const a = await createAssetRecord(storeA, {
      key: 'media-a/tagged.png',
      kind: 'image',
      mime: 'image/png',
    });
    await attachTag(storeA, a.id, 'hero');
    await attachTag(storeA, a.id, 'hero'); // idempotent
    await attachTag(storeA, a.id, 'banner');
    expect(await listTags(storeA, a.id)).toEqual(['banner', 'hero']);

    const byTag = await listAssets(storeA, { tag: 'hero', limit: 50 });
    expect(byTag.items.map(x => x.id)).toContain(a.id);

    await removeTag(storeA, a.id, 'hero');
    expect(await listTags(storeA, a.id)).toEqual(['banner']);
  });

  it('recordDerivative replaces an existing (asset, preset) row', async () => {
    const a = await createAssetRecord(storeA, {
      key: 'media-a/deriv.png',
      kind: 'image',
      mime: 'image/png',
    });
    await recordDerivative(storeA, { assetId: a.id, preset: 'card', width: 320, height: 320, url: '/v1' });
    await recordDerivative(storeA, { assetId: a.id, preset: 'card', width: 320, height: 320, url: '/v2' });
    const derivs = await listDerivatives(storeA, a.id);
    const card = derivs.filter(d => d.preset === 'card');
    expect(card.length).toBe(1);
    expect(card[0]!.url).toBe('/v2');
  });

  it('RLS isolates assets across stores', async () => {
    const aAsset = await createAssetRecord(storeA, {
      key: 'media-a/secret.png',
      kind: 'image',
      mime: 'image/png',
    });
    const bAsset = await createAssetRecord(storeB, {
      key: 'media-b/secret.png',
      kind: 'image',
      mime: 'image/png',
    });

    // Store B cannot see store A's asset (404 from getAsset, absent from list).
    await expect(getAsset(storeB, aAsset.id)).rejects.toBeInstanceOf(AssetNotFoundError);
    const bList = await listAssets(storeB, { limit: 200 });
    const bIds = bList.items.map(a => a.id);
    expect(bIds).toContain(bAsset.id);
    expect(bIds).not.toContain(aAsset.id);

    // migrator (BYPASSRLS) sees both — proves isolation came from RLS.
    const all = await migratorClient<{ id: string }[]>`SELECT id FROM assets`;
    const allIds = all.map(r => r.id);
    expect(allIds).toContain(aAsset.id);
    expect(allIds).toContain(bAsset.id);
  });

  it('attachTag across a tenant boundary cannot tag another store asset', async () => {
    const aAsset = await createAssetRecord(storeA, {
      key: 'media-a/xtag.png',
      kind: 'image',
      mime: 'image/png',
    });
    // Store B's tenant scope can't see A's asset → AssetNotFoundError.
    await expect(attachTag(storeB, aAsset.id, 'nope')).rejects.toBeInstanceOf(AssetNotFoundError);
  });
});
