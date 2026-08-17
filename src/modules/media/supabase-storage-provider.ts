/**
 * SupabaseStorageProvider — Supabase Storage MediaProvider (migration Phase 3).
 *
 * Replaces the R2 + imgproxy pair with a single managed service:
 *
 * - presignUpload: `createSignedUploadUrl(path)` returns a short-lived signed
 *   URL the browser PUTs the bytes straight to. No object bytes pass through
 *   the app, same as the R2 pre-signed PUT flow.
 * - finalizeUpload: `info(path)` reads the real stored size, so a client that
 *   lies about `bytes` cannot poison the row. Image dimensions still come from
 *   the client hint (decoding server-side is the image.post-process job's job).
 * - deriveUrl: `getPublicUrl(path)`. When SUPABASE_STORAGE_TRANSFORM is on, the
 *   preset is applied via Supabase's render endpoint (`resize: contain` at the
 *   preset's longest edge) — the imgproxy replacement. Left OFF by default
 *   because image transformation is a PAID Supabase feature: on the free tier
 *   `/render/image/**` errors, so the default serves the original object and
 *   images render (unoptimised) rather than breaking. Flip the flag after
 *   upgrading the project; no code or data change is needed.
 *
 * Signing uploads requires a key that can write to the bucket, i.e. the SECRET
 * (service_role) key. It is read server-side only and must never be exposed to
 * the browser — do NOT give it a NEXT_PUBLIC_ name. It bypasses RLS.
 *
 * The client is constructed lazily and cached, so importing this module is
 * cheap and credential-free until the first real call.
 */

import crypto from 'node:crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { env } from '@/lib/env';
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
import { MediaProviderConfigError } from './errors';

interface SupabaseStorageConfig {
  url: string;
  serviceKey: string;
  bucket: string;
  transform: boolean;
}

export class SupabaseStorageProvider implements MediaProvider {
  public readonly name = 'supabase-storage' as const;
  private _client: SupabaseClient | undefined;

  private config(): SupabaseStorageConfig {
    const missing: string[] = [];
    if (!env.SUPABASE_URL) missing.push('SUPABASE_URL');
    if (!env.SUPABASE_SERVICE_ROLE_KEY) missing.push('SUPABASE_SERVICE_ROLE_KEY');
    if (missing.length > 0) throw new MediaProviderConfigError(this.name, missing);
    return {
      url: env.SUPABASE_URL!,
      serviceKey: env.SUPABASE_SERVICE_ROLE_KEY!,
      bucket: env.SUPABASE_STORAGE_BUCKET,
      transform: env.SUPABASE_STORAGE_TRANSFORM,
    };
  }

  private client(cfg: SupabaseStorageConfig): SupabaseClient {
    if (this._client) return this._client;
    this._client = createClient(cfg.url, cfg.serviceKey, {
      // Server-side service client: never persist or refresh a user session.
      auth: { persistSession: false, autoRefreshToken: false },
    });
    return this._client;
  }

  async presignUpload(input: PresignUploadInput): Promise<PresignUploadResult> {
    const cfg = this.config();
    const assetId = crypto.randomUUID();
    const ext = extFromMime(input.mime);
    // Same key shape as the R2 provider so keys stay portable across providers.
    const key = `${input.storeSlug}/${assetId}.${ext}`;

    const { data, error } = await this.client(cfg)
      .storage.from(cfg.bucket)
      .createSignedUploadUrl(key);
    if (error || !data) {
      throw new Error(`supabase storage: createSignedUploadUrl failed — ${error?.message}`);
    }

    return {
      assetId,
      key,
      uploadUrl: data.signedUrl,
      // The signed URL carries its own auth token in the query string; the only
      // header the client must echo is the content type.
      headers: { 'content-type': input.mime },
      kind: kindFromMime(input.mime),
    };
  }

  async finalizeUpload(input: FinalizeUploadInput): Promise<FinalizeUploadResult> {
    const cfg = this.config();
    const { data } = await this.client(cfg).storage.from(cfg.bucket).info(input.key);
    return {
      // Prefer the real stored size; fall back to the client's claim only when
      // the object metadata is unavailable.
      bytes: data?.size ?? input.bytes ?? 0,
      // Dimensions are decoded by the image.post-process job; trust the hint.
      width: input.width ?? null,
      height: input.height ?? null,
      checksum: input.checksum ?? null,
    };
  }

  deriveUrl(asset: DeriveAsset, preset: DerivativePreset): string {
    const cfg = this.config();
    const size = DERIVATIVE_PRESETS[preset];
    const storage = this.client(cfg).storage.from(cfg.bucket);
    // SVGs must never go through raster transformation — serve them verbatim.
    const useTransform = cfg.transform && asset.kind === 'image';
    const { data } = useTransform
      ? storage.getPublicUrl(asset.key, {
          transform: { width: size, height: size, resize: 'contain' },
        })
      : storage.getPublicUrl(asset.key);
    return data.publicUrl;
  }
}
