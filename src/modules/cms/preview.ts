import { hmacSha256Hex, safeEqualStrings } from '@/modules/payments/signature';
import { env } from '@/lib/env';

/**
 * Signed preview tokens let a future admin "preview" route render a specific
 * DRAFT version of a page without it being published. The token binds to BOTH
 * pageId and versionId (per the plan's preview-security risk: don't bind to
 * page id alone) and carries a short TTL.
 *
 * Token format (URL-safe): base64url(payloadJson) + '.' + hmacHex
 * where payloadJson = { pageId, versionId, exp } and the HMAC is over the
 * base64url payload using SESSION_SECRET. No secret material is embedded.
 */

const PREVIEW_TTL_SECONDS = 5 * 60; // 5 minutes

export type PreviewPayload = {
  pageId: string;
  versionId: string;
  /** Unix epoch seconds at which the token expires. */
  exp: number;
};

function base64UrlEncode(input: string): string {
  return Buffer.from(input, 'utf8').toString('base64url');
}

function base64UrlDecode(input: string): string {
  return Buffer.from(input, 'base64url').toString('utf8');
}

function secret(): string {
  return env.SESSION_SECRET;
}

/**
 * Sign a preview token for (pageId, versionId). `ttlSeconds` defaults to 5min;
 * `now` is injectable for tests.
 */
export function signPreviewToken(
  pageId: string,
  versionId: string,
  opts: { ttlSeconds?: number; now?: number } = {},
): string {
  const nowSec = Math.floor((opts.now ?? Date.now()) / 1000);
  const exp = nowSec + (opts.ttlSeconds ?? PREVIEW_TTL_SECONDS);
  const payload: PreviewPayload = { pageId, versionId, exp };
  const encoded = base64UrlEncode(JSON.stringify(payload));
  const sig = hmacSha256Hex(secret(), encoded);
  return `${encoded}.${sig}`;
}

export type VerifyResult =
  | { ok: true; payload: PreviewPayload }
  | { ok: false; reason: 'malformed' | 'bad_signature' | 'expired' };

/**
 * Verify and decode a preview token. Returns the bound (pageId, versionId) on
 * success. `now` is injectable for tests. Constant-time signature comparison.
 */
export function verifyPreviewToken(
  token: string,
  opts: { now?: number } = {},
): VerifyResult {
  const dot = token.lastIndexOf('.');
  if (dot <= 0 || dot === token.length - 1) return { ok: false, reason: 'malformed' };

  const encoded = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const expected = hmacSha256Hex(secret(), encoded);
  if (!safeEqualStrings(expected, sig)) return { ok: false, reason: 'bad_signature' };

  let payload: PreviewPayload;
  try {
    const parsed = JSON.parse(base64UrlDecode(encoded)) as unknown;
    if (
      typeof parsed !== 'object' || parsed === null ||
      typeof (parsed as PreviewPayload).pageId !== 'string' ||
      typeof (parsed as PreviewPayload).versionId !== 'string' ||
      typeof (parsed as PreviewPayload).exp !== 'number'
    ) {
      return { ok: false, reason: 'malformed' };
    }
    payload = parsed as PreviewPayload;
  } catch {
    return { ok: false, reason: 'malformed' };
  }

  const nowSec = Math.floor((opts.now ?? Date.now()) / 1000);
  if (nowSec >= payload.exp) return { ok: false, reason: 'expired' };

  return { ok: true, payload };
}
