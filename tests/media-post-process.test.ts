/**
 * SP-8 image.post-process job — generates derivative rows for an image asset
 * at the standard presets and skips non-image assets. Invokes the handler
 * directly with a minimal fake Job (no Redis). Real Postgres.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { Job } from 'bullmq';
import { resetAndMigrate } from './_setup/db';
import { migratorClient } from '@/db/client';
import { createAssetRecord, listDerivatives } from '@/modules/media/assets';
import {
  imagePostProcess,
  type ImagePostProcessPayload,
} from '@/queue/jobs/image-post-process';
import { DERIVATIVE_PRESETS } from '@/modules/media/provider';

function fakeJob(data: ImagePostProcessPayload): Job<ImagePostProcessPayload> {
  return { id: 'test-job', data } as Job<ImagePostProcessPayload>;
}

async function createStore(slug: string): Promise<string> {
  const rows = await migratorClient<{ id: string }[]>`
    INSERT INTO stores (slug, name) VALUES (${slug}, ${slug}) RETURNING id
  `;
  return rows[0]!.id;
}

describe('image.post-process job', () => {
  let store: string;

  beforeAll(async () => {
    await resetAndMigrate();
    store = await createStore('pp-store');
  });

  afterAll(async () => {
    await migratorClient.end();
  });

  it('creates one derivative row per preset for an image asset', async () => {
    const asset = await createAssetRecord(store, {
      key: 'pp-store/hero.png',
      kind: 'image',
      mime: 'image/png',
      width: 2000,
      height: 1500,
    });

    const result = await imagePostProcess(fakeJob({ storeId: store, assetId: asset.id }));
    const presetCount = Object.keys(DERIVATIVE_PRESETS).length;
    expect(result.derivatives).toBe(presetCount);

    const derivs = await listDerivatives(store, asset.id);
    expect(derivs.length).toBe(presetCount);
    const presets = derivs.map(d => d.preset).sort();
    expect(presets).toEqual(Object.keys(DERIVATIVE_PRESETS).sort());
    // Stub provider URLs encode the preset.
    for (const d of derivs) {
      expect(d.url).toContain(`/media/stub/${d.preset}/`);
    }
  });

  it('is idempotent — re-running does not duplicate rows', async () => {
    const asset = await createAssetRecord(store, {
      key: 'pp-store/again.png',
      kind: 'image',
      mime: 'image/png',
    });
    await imagePostProcess(fakeJob({ storeId: store, assetId: asset.id }));
    await imagePostProcess(fakeJob({ storeId: store, assetId: asset.id }));
    const derivs = await listDerivatives(store, asset.id);
    expect(derivs.length).toBe(Object.keys(DERIVATIVE_PRESETS).length);
  });

  it('skips non-image assets (svg/doc) without creating derivatives', async () => {
    const svg = await createAssetRecord(store, {
      key: 'pp-store/icon.svg',
      kind: 'svg',
      mime: 'image/svg+xml',
    });
    const result = await imagePostProcess(fakeJob({ storeId: store, assetId: svg.id }));
    expect(result.derivatives).toBe(0);
    expect(result.skipped).toBe('not-image');
    expect((await listDerivatives(store, svg.id)).length).toBe(0);
  });
});
