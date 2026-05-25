import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Compute a hex-encoded HMAC-SHA256 of `body` using `secret`.
 *
 * Used by:
 *   - Razorpay inbound webhook verification (compared against
 *     `x-razorpay-signature` header — see `razorpay.ts`)
 *   - SP-5 outbound webhook signing (we sign our own dispatches the same way
 *     so subscribers can verify with a shared secret)
 */
export function hmacSha256Hex(secret: string, body: string): string {
  return createHmac('sha256', secret).update(body, 'utf8').digest('hex');
}

/**
 * Constant-time comparison of two strings expected to be the same length.
 *
 * Returns false if the lengths differ (so `timingSafeEqual` never throws on
 * mismatched buffer sizes — which would itself be a timing oracle). Inputs are
 * treated as utf8 byte sequences.
 */
export function safeEqualStrings(a: string, b: string): boolean {
  const ab = Buffer.from(a, 'utf8');
  const bb = Buffer.from(b, 'utf8');
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

/**
 * Verify an HMAC-SHA256 hex signature against `(secret, body)`. Pure
 * function — no side effects, no environment reads — so it's safe to use
 * from outbound webhook dispatch (SP-5) as well as inbound verification.
 */
export function verifyHmacSha256Hex(
  secret: string,
  body: string,
  signatureHex: string,
): boolean {
  const expected = hmacSha256Hex(secret, body);
  return safeEqualStrings(expected, signatureHex);
}
