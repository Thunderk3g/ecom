import { describe, it, expect } from 'vitest';

import {
  hmacSha256Hex,
  safeEqualStrings,
  verifyHmacSha256Hex,
} from '@/modules/payments/signature';

describe('payments/signature', () => {
  const secret = 'whsec_test_secret_value';
  const body = JSON.stringify({ event: 'payment.captured', payload: { foo: 'bar' } });

  it('round-trips: a body signed with the secret verifies against the same secret', () => {
    const sig = hmacSha256Hex(secret, body);
    expect(sig).toMatch(/^[0-9a-f]{64}$/); // SHA-256 hex
    expect(verifyHmacSha256Hex(secret, body, sig)).toBe(true);
  });

  it('rejects when the body is mutated by even one byte', () => {
    const sig = hmacSha256Hex(secret, body);
    const tampered = body.replace('"bar"', '"baz"');
    expect(verifyHmacSha256Hex(secret, tampered, sig)).toBe(false);
  });

  it('rejects when the secret is wrong', () => {
    const sig = hmacSha256Hex(secret, body);
    expect(verifyHmacSha256Hex('wrong_secret', body, sig)).toBe(false);
  });

  it('rejects an empty / missing signature', () => {
    expect(verifyHmacSha256Hex(secret, body, '')).toBe(false);
  });

  it('rejects a signature of the wrong length without throwing', () => {
    // timingSafeEqual would normally throw on mismatched-length buffers —
    // safeEqualStrings must guard against that to preserve constant-time
    // semantics.
    expect(() => verifyHmacSha256Hex(secret, body, 'deadbeef')).not.toThrow();
    expect(verifyHmacSha256Hex(secret, body, 'deadbeef')).toBe(false);
  });

  it('safeEqualStrings: equal strings compare equal, different ones do not', () => {
    expect(safeEqualStrings('abc', 'abc')).toBe(true);
    expect(safeEqualStrings('abc', 'abd')).toBe(false);
    expect(safeEqualStrings('abc', 'abcd')).toBe(false);
    expect(safeEqualStrings('', '')).toBe(true);
  });
});
