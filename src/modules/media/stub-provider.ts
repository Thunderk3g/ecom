/**
 * StubMediaProvider — the default MediaProvider for dev + tests.
 *
 * - presignUpload: allocates an assetId + content-addressed key and returns a
 *   *local* PUT URL (`/api/v1/admin/media/__stub_put__/<assetId>`). The stub PUT
 *   receiver route returns 204 and discards the body — no object storage, no
 *   network. The client (or a test) "uploads" by calling that endpoint.
 * - finalizeUpload: trusts the client-reported metadata (bytes/width/height/
 *   checksum) since there is no real object to inspect. Defaults missing numeric
 *   fields to 0/null.
 * - deriveUrl: returns a deterministic local-ish URL encoding the preset so
 *   tests can assert on it without a running imgproxy.
 */

import crypto from 'node:crypto';
import type {
  DeriveAsset,
  DerivativePreset,
  FinalizeUploadInput,
  FinalizeUploadResult,
  MediaProvider,
  PresignUploadInput,
  PresignUploadResult,
} from './provider';
import { DERIVATIVE_PRESETS, extFromMime, kindFromMime } from './provider';

export class StubMediaProvider implements MediaProvider {
  public readonly name = 'stub' as const;

  presignUpload(input: PresignUploadInput): Promise<PresignUploadResult> {
    const assetId = crypto.randomUUID();
    const ext = extFromMime(input.mime);
    // Content-addressed-ish key: in the stub we don't have the bytes yet, so we
    // use the assetId as the unique component. R2Provider uses the same shape.
    const key = `${input.storeSlug}/${assetId}.${ext}`;
    const uploadUrl = `/api/v1/admin/media/__stub_put__/${assetId}`;
    return Promise.resolve({
      assetId,
      key,
      uploadUrl,
      headers: { 'content-type': input.mime },
      kind: kindFromMime(input.mime),
    });
  }

  finalizeUpload(input: FinalizeUploadInput): Promise<FinalizeUploadResult> {
    // No real object to inspect — trust the client-reported metadata.
    return Promise.resolve({
      bytes: input.bytes ?? 0,
      width: input.width ?? null,
      height: input.height ?? null,
      checksum: input.checksum ?? null,
    });
  }

  deriveUrl(asset: DeriveAsset, preset: DerivativePreset): string {
    const size = DERIVATIVE_PRESETS[preset];
    return `/media/stub/${preset}/${size}/${asset.key}`;
  }
}
