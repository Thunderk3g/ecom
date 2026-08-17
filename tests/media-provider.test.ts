/**
 * SP-8 MediaProvider — stub presign + finalize round-trip, kind/ext mapping,
 * and the imgproxy URL signer. No DB, no network.
 */

import { describe, it, expect } from 'vitest';
import { StubMediaProvider } from '@/modules/media/stub-provider';
import {
  getMediaProvider,
  resetMediaProvider,
  kindFromMime,
  extFromMime,
  DERIVATIVE_PRESETS,
} from '@/modules/media/provider';
import { signImgproxyPath } from '@/modules/media/r2-provider';

describe('StubMediaProvider', () => {
  const provider = new StubMediaProvider();

  it('presignUpload returns an assetId, content-addressed key, and a local stub PUT URL', async () => {
    const res = await provider.presignUpload({
      storeSlug: 'acme',
      filename: 'logo.png',
      mime: 'image/png',
      bytes: 2048,
    });
    expect(res.assetId).toMatch(/^[0-9a-f-]{36}$/);
    expect(res.key).toBe(`acme/${res.assetId}.png`);
    expect(res.uploadUrl).toBe(`/api/v1/admin/media/stub-put/${res.assetId}`);
    expect(res.headers['content-type']).toBe('image/png');
    expect(res.kind).toBe('image');
  });

  it('finalizeUpload trusts client-reported metadata, defaulting missing fields', async () => {
    const presigned = await provider.presignUpload({
      storeSlug: 'acme',
      filename: 'pic.jpg',
      mime: 'image/jpeg',
      bytes: 9999,
    });
    const finalized = await provider.finalizeUpload({
      assetId: presigned.assetId,
      key: presigned.key,
      mime: 'image/jpeg',
      bytes: 9999,
      width: 800,
      height: 600,
      checksum: 'abc123',
    });
    expect(finalized).toEqual({ bytes: 9999, width: 800, height: 600, checksum: 'abc123' });

    const bare = await provider.finalizeUpload({
      assetId: presigned.assetId,
      key: presigned.key,
      mime: 'image/jpeg',
    });
    expect(bare).toEqual({ bytes: 0, width: null, height: null, checksum: null });
  });

  it('deriveUrl encodes preset + size + key', () => {
    const url = provider.deriveUrl(
      { storeSlug: 'acme', key: 'acme/x.png', kind: 'image' },
      'card',
    );
    expect(url).toBe(`/media/stub/card/${DERIVATIVE_PRESETS.card}/acme/x.png`);
  });
});

describe('mime helpers', () => {
  it('maps svg to its own kind, other image/* to image, rest to doc', () => {
    expect(kindFromMime('image/svg+xml')).toBe('svg');
    expect(kindFromMime('image/png')).toBe('image');
    expect(kindFromMime('image/webp')).toBe('image');
    expect(kindFromMime('application/pdf')).toBe('doc');
  });
  it('maps mime to a sane extension with bin fallback', () => {
    expect(extFromMime('image/jpeg')).toBe('jpg');
    expect(extFromMime('image/svg+xml')).toBe('svg');
    expect(extFromMime('application/pdf')).toBe('pdf');
    expect(extFromMime('application/octet-stream')).toBe('bin');
  });
});

describe('getMediaProvider factory', () => {
  it("returns the stub provider under MEDIA_PROVIDER=stub (test default)", () => {
    resetMediaProvider();
    const p = getMediaProvider();
    expect(p.name).toBe('stub');
    // cached singleton
    expect(getMediaProvider()).toBe(p);
  });
});

describe('imgproxy signer', () => {
  it('is deterministic and base64url (no +/=) for a given key/salt/path', () => {
    // Arbitrary hex key + salt (the imgproxy spec hex-decodes both).
    const key = 'a'.repeat(64);
    const salt = 'b'.repeat(32);
    const path = '/rs:fit:320:320:0/f:webp/aHR0cDovL2V4YW1wbGUv';
    const sig1 = signImgproxyPath(key, salt, path);
    const sig2 = signImgproxyPath(key, salt, path);
    expect(sig1).toBe(sig2);
    expect(sig1).toMatch(/^[A-Za-z0-9_-]+$/);
    // A different path yields a different signature.
    expect(signImgproxyPath(key, salt, path + 'x')).not.toBe(sig1);
  });
});
