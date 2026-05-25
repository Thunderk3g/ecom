/**
 * Outbound webhook signature helpers.
 *
 * Wraps the primitive HMAC helpers in `src/modules/payments/signature.ts` to
 * produce / verify Stripe-style signature headers:
 *
 *   X-Inkwell-Signature: t=<unix-seconds>,v1=<hmac-sha256-hex>
 *
 * The signed payload is `<unix-seconds>.<body>` — concatenating the timestamp
 * mitigates replay attacks: a captured (header, body) pair past the tolerance
 * window will fail verification even if the secret is unchanged.
 *
 * Subscribers can verify with any HMAC-SHA256 library; the format is documented
 * for partners in the admin webhook UI.
 */

import { hmacSha256Hex, safeEqualStrings } from '@/modules/payments/signature';

/** Default replay tolerance in seconds (5 minutes — matches Stripe default). */
export const DEFAULT_TOLERANCE_SECONDS = 300;

/**
 * Build the signed payload string that we HMAC. Exposed for tests; callers
 * should prefer `signWebhookPayload` / `verifyWebhookSignature`.
 */
export function buildSignedPayload(timestamp: number, body: string): string {
  return `${timestamp}.${body}`;
}

/**
 * Sign an outbound webhook body. Returns the full header value, suitable for
 * `X-Inkwell-Signature`. `timestamp` is unix seconds (caller may use
 * `Math.floor(Date.now()/1000)` — the value is round-tripped into the header).
 */
export function signWebhookPayload(
  secret: string,
  body: string,
  timestamp: number,
): string {
  const sig = hmacSha256Hex(secret, buildSignedPayload(timestamp, body));
  return `t=${timestamp},v1=${sig}`;
}

/**
 * Parse a header value of the form `t=<unix>,v1=<hex>[,v1=<hex>...]`. Returns
 * the timestamp and the list of v1 signatures (more than one can be present
 * during secret rotation). Returns null if the shape is malformed.
 */
function parseSignatureHeader(
  headerValue: string,
): { timestamp: number; signatures: string[] } | null {
  let timestamp: number | null = null;
  const signatures: string[] = [];
  const parts = headerValue.split(',');
  for (const part of parts) {
    const eq = part.indexOf('=');
    if (eq < 0) return null;
    const key = part.slice(0, eq).trim();
    const value = part.slice(eq + 1).trim();
    if (key === 't') {
      const n = Number.parseInt(value, 10);
      if (!Number.isFinite(n)) return null;
      timestamp = n;
    } else if (key === 'v1') {
      signatures.push(value);
    }
    // Unknown schemes ignored — forward-compat for future v2 etc.
  }
  if (timestamp === null || signatures.length === 0) return null;
  return { timestamp, signatures };
}

/**
 * Verify an inbound `X-Inkwell-Signature` header against `(secret, body)`.
 *
 * Steps (mirrors Stripe's verification recipe):
 *   1. Parse the header into `t=<unix>` and one-or-more `v1=<hex>` signatures.
 *   2. Reject if the timestamp drift exceeds `toleranceSeconds` (replay guard).
 *   3. Recompute HMAC of `<t>.<body>` and constant-time compare against each
 *      provided v1 signature.
 *
 * Returns true only if exactly one signature matches. Constant-time comparison
 * is delegated to `safeEqualStrings`.
 */
export function verifyWebhookSignature(
  secret: string,
  body: string,
  headerValue: string,
  toleranceSeconds: number = DEFAULT_TOLERANCE_SECONDS,
): boolean {
  const parsed = parseSignatureHeader(headerValue);
  if (!parsed) return false;

  const nowSeconds = Math.floor(Date.now() / 1000);
  if (Math.abs(nowSeconds - parsed.timestamp) > toleranceSeconds) return false;

  const expected = hmacSha256Hex(secret, buildSignedPayload(parsed.timestamp, body));
  for (const sig of parsed.signatures) {
    if (safeEqualStrings(expected, sig)) return true;
  }
  return false;
}
