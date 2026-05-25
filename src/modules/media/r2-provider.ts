/**
 * R2Provider — Cloudflare R2 (S3-compatible) + imgproxy MediaProvider.
 *
 * - presignUpload: builds a content-addressed object key and a pre-signed PUT
 *   URL (S3 SDK + s3-request-presigner) the browser uploads directly to. The
 *   key uses a random uuid component since the sha256 of the bytes isn't known
 *   until the object lands; finalizeUpload records the real checksum.
 * - finalizeUpload: HEADs the uploaded object to read its real size, then
 *   trusts client-reported image dimensions (extracting dimensions server-side
 *   would require an image decoder — that runs in the image.post-process job).
 * - deriveUrl: builds an imgproxy URL signed with HMAC-SHA256 per the imgproxy
 *   "signed URL" spec (key+salt are hex-decoded; signature is base64url of
 *   HMAC(salt || path)).
 *
 * The S3 client is constructed lazily and cached so importing this module is
 * cheap and credential-free until the first real call. Missing config throws
 * MediaProviderConfigError.
 */

import crypto from 'node:crypto';
import { S3Client, PutObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
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

const PUT_URL_TTL_SECONDS = 15 * 60;

interface R2Config {
  accountId: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
  publicBaseUrl: string;
}

interface ImgproxyConfig {
  baseUrl: string;
  key: string;
  salt: string;
}

export class R2Provider implements MediaProvider {
  public readonly name = 'r2-imgproxy' as const;
  private _client: S3Client | undefined;

  private r2Config(): R2Config {
    const missing: string[] = [];
    if (!env.R2_ACCOUNT_ID) missing.push('R2_ACCOUNT_ID');
    if (!env.R2_ACCESS_KEY_ID) missing.push('R2_ACCESS_KEY_ID');
    if (!env.R2_SECRET_ACCESS_KEY) missing.push('R2_SECRET_ACCESS_KEY');
    if (!env.R2_BUCKET) missing.push('R2_BUCKET');
    if (!env.R2_PUBLIC_BASE_URL) missing.push('R2_PUBLIC_BASE_URL');
    if (missing.length > 0) throw new MediaProviderConfigError(this.name, missing);
    return {
      accountId: env.R2_ACCOUNT_ID!,
      accessKeyId: env.R2_ACCESS_KEY_ID!,
      secretAccessKey: env.R2_SECRET_ACCESS_KEY!,
      bucket: env.R2_BUCKET!,
      publicBaseUrl: env.R2_PUBLIC_BASE_URL!,
    };
  }

  private imgproxyConfig(): ImgproxyConfig {
    const missing: string[] = [];
    if (!env.IMGPROXY_BASE_URL) missing.push('IMGPROXY_BASE_URL');
    if (!env.IMGPROXY_KEY) missing.push('IMGPROXY_KEY');
    if (!env.IMGPROXY_SALT) missing.push('IMGPROXY_SALT');
    if (missing.length > 0) throw new MediaProviderConfigError(this.name, missing);
    return { baseUrl: env.IMGPROXY_BASE_URL!, key: env.IMGPROXY_KEY!, salt: env.IMGPROXY_SALT! };
  }

  private client(cfg: R2Config): S3Client {
    if (this._client) return this._client;
    this._client = new S3Client({
      region: 'auto',
      endpoint: `https://${cfg.accountId}.r2.cloudflarestorage.com`,
      credentials: { accessKeyId: cfg.accessKeyId, secretAccessKey: cfg.secretAccessKey },
    });
    return this._client;
  }

  async presignUpload(input: PresignUploadInput): Promise<PresignUploadResult> {
    const cfg = this.r2Config();
    const assetId = crypto.randomUUID();
    const ext = extFromMime(input.mime);
    const key = `${input.storeSlug}/${assetId}.${ext}`;
    const command = new PutObjectCommand({
      Bucket: cfg.bucket,
      Key: key,
      ContentType: input.mime,
      ContentLength: input.bytes,
    });
    const uploadUrl = await getSignedUrl(this.client(cfg), command, {
      expiresIn: PUT_URL_TTL_SECONDS,
    });
    return {
      assetId,
      key,
      uploadUrl,
      headers: { 'content-type': input.mime },
      kind: kindFromMime(input.mime),
    };
  }

  async finalizeUpload(input: FinalizeUploadInput): Promise<FinalizeUploadResult> {
    const cfg = this.r2Config();
    const head = await this.client(cfg).send(
      new HeadObjectCommand({ Bucket: cfg.bucket, Key: input.key }),
    );
    return {
      // Real byte count comes from the stored object; fall back to client value.
      bytes: head.ContentLength ?? input.bytes ?? 0,
      // Dimensions are decoded by the image.post-process job; trust client hint here.
      width: input.width ?? null,
      height: input.height ?? null,
      checksum: input.checksum ?? null,
    };
  }

  deriveUrl(asset: DeriveAsset, preset: DerivativePreset): string {
    const cfg = this.r2Config();
    const ip = this.imgproxyConfig();
    const size = DERIVATIVE_PRESETS[preset];
    const sourceUrl = `${cfg.publicBaseUrl.replace(/\/$/, '')}/${asset.key}`;
    const encodedSource = Buffer.from(sourceUrl, 'utf8').toString('base64url');
    // imgproxy processing path: resize fit, longest edge = size, webp output.
    const path = `/rs:fit:${size}:${size}:0/f:webp/${encodedSource}`;
    const signature = signImgproxyPath(ip.key, ip.salt, path);
    return `${ip.baseUrl.replace(/\/$/, '')}/${signature}${path}`;
  }
}

/**
 * imgproxy URL signing per the spec: hex-decode key + salt, compute
 * HMAC-SHA256 over (salt_bytes || path_bytes), and base64url-encode the digest.
 */
export function signImgproxyPath(keyHex: string, saltHex: string, path: string): string {
  const key = Buffer.from(keyHex, 'hex');
  const salt = Buffer.from(saltHex, 'hex');
  const hmac = crypto.createHmac('sha256', key);
  hmac.update(salt);
  hmac.update(path);
  return hmac.digest('base64url');
}
