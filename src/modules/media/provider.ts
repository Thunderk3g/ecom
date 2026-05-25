/**
 * SP-8 MediaProvider abstraction.
 *
 * A MediaProvider owns the object-storage + derivative concerns that vary by
 * deployment: where uploads land (pre-signed PUT target), how an upload is
 * validated/finalized, and how a derivative (resize) URL is built. The asset
 * registry (`./assets.ts`) and the HTTP routes call only this interface — they
 * never import the R2 SDK or imgproxy signer directly.
 *
 * Two implementations:
 *   - StubMediaProvider (`./stub-provider.ts`) — default. Local PUT receiver,
 *     no network. Used for dev + tests.
 *   - R2Provider (`./r2-provider.ts`) — Cloudflare R2 (S3-compatible) pre-signed
 *     PUT + imgproxy signed derivative URLs.
 *
 * Selection is driven by env `MEDIA_PROVIDER` (default 'stub'). A real provider
 * throws `MediaProviderConfigError` lazily on first use if its keys are absent.
 */

import { env } from '@/lib/env';
import { MediaProviderConfigError } from './errors';
import { StubMediaProvider } from './stub-provider';
import { R2Provider } from './r2-provider';

export type AssetKind = 'image' | 'svg' | 'doc';

/** Named derivative presets. Image dimensions are the longest-edge target. */
export const DERIVATIVE_PRESETS = {
  thumb: 128,
  card: 320,
  detail: 800,
  hero: 1600,
} as const;

export type DerivativePreset = keyof typeof DERIVATIVE_PRESETS;

export interface PresignUploadInput {
  storeSlug: string;
  filename: string;
  mime: string;
  bytes: number;
}

export interface PresignUploadResult {
  /** Pre-allocated asset id; the registry persists a pending row under it. */
  assetId: string;
  /** Content-addressed object key the file will live at. */
  key: string;
  /** URL the client PUTs the raw bytes to. */
  uploadUrl: string;
  /** Headers the client must echo on the PUT (e.g. Content-Type). */
  headers: Record<string, string>;
  /** Derived asset kind from the mime type. */
  kind: AssetKind;
}

export interface FinalizeUploadInput {
  assetId: string;
  key: string;
  mime: string;
  /** Client-reported metadata; the provider validates/trusts per implementation. */
  bytes?: number;
  width?: number;
  height?: number;
  checksum?: string;
}

export interface FinalizeUploadResult {
  bytes: number;
  width: number | null;
  height: number | null;
  checksum: string | null;
}

export interface DeriveAsset {
  storeSlug: string;
  key: string;
  kind: AssetKind;
}

export interface MediaProvider {
  readonly name: 'r2-imgproxy' | 'stub';
  presignUpload(input: PresignUploadInput): Promise<PresignUploadResult>;
  finalizeUpload(input: FinalizeUploadInput): Promise<FinalizeUploadResult>;
  /** Build a (possibly signed) URL for a derivative of `asset` at `preset`. */
  deriveUrl(asset: DeriveAsset, preset: DerivativePreset): string;
}

/** Map a mime type to our coarse asset kind. */
export function kindFromMime(mime: string): AssetKind {
  if (mime === 'image/svg+xml') return 'svg';
  if (mime.startsWith('image/')) return 'image';
  return 'doc';
}

/** Derive a sane file extension from a mime type (fallback: 'bin'). */
export function extFromMime(mime: string): string {
  const map: Record<string, string> = {
    'image/jpeg': 'jpg',
    'image/png': 'png',
    'image/webp': 'webp',
    'image/avif': 'avif',
    'image/gif': 'gif',
    'image/svg+xml': 'svg',
    'application/pdf': 'pdf',
  };
  return map[mime] ?? 'bin';
}

let _provider: MediaProvider | undefined;

/**
 * Factory: returns the singleton MediaProvider selected by `MEDIA_PROVIDER`.
 * Construction is lazy and cached. Real providers do NOT eagerly validate keys
 * here — they throw `MediaProviderConfigError` at first use so the 'stub'
 * default keeps dev/test credential-free.
 */
export function getMediaProvider(): MediaProvider {
  if (_provider) return _provider;
  const selected = env.MEDIA_PROVIDER;
  if (selected === 'r2-imgproxy') {
    // R2Provider constructs its S3 client lazily, so importing it is cheap and
    // credential-free until the first real presign/finalize call.
    _provider = new R2Provider();
  } else if (selected === 'stub') {
    _provider = new StubMediaProvider();
  } else {
    throw new MediaProviderConfigError(String(selected), ['MEDIA_PROVIDER']);
  }
  return _provider;
}

/** Test seam: reset the cached provider (e.g. after changing env in a test). */
export function resetMediaProvider(): void {
  _provider = undefined;
}
