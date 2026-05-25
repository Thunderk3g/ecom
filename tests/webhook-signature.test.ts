/**
 * Outbound webhook signature — sign + verify round-trip and rejection cases.
 *
 * Header format: `t=<unix-seconds>,v1=<hmac-sha256-hex>`.
 * Signed payload: `<t>.<body>`.
 *
 * Cases:
 *   - sign/verify round-trip succeeds.
 *   - tampered body fails verification.
 *   - timestamp older than tolerance fails (replay guard).
 *   - malformed header (missing t, missing v1, garbage) fails.
 */

import { describe, it, expect } from 'vitest';
import {
  buildSignedPayload,
  DEFAULT_TOLERANCE_SECONDS,
  signWebhookPayload,
  verifyWebhookSignature,
} from '@/modules/webhooks/signature';

describe('outbound webhook signature', () => {
  const secret = 'webhook_secret_for_unit_tests_only';
  const body = JSON.stringify({ id: 'evt_1', topic: 'order.paid', data: {} });

  it('sign + verify round-trip succeeds', () => {
    const t = Math.floor(Date.now() / 1000);
    const header = signWebhookPayload(secret, body, t);
    expect(header.startsWith(`t=${t},v1=`)).toBe(true);
    expect(verifyWebhookSignature(secret, body, header)).toBe(true);
  });

  it('tampered body fails verification', () => {
    const t = Math.floor(Date.now() / 1000);
    const header = signWebhookPayload(secret, body, t);
    const tampered = body.replace('order.paid', 'order.refunded');
    expect(verifyWebhookSignature(secret, tampered, header)).toBe(false);
  });

  it('expired timestamp (older than tolerance) is rejected', () => {
    const old = Math.floor(Date.now() / 1000) - DEFAULT_TOLERANCE_SECONDS - 60;
    const header = signWebhookPayload(secret, body, old);
    // The HMAC matches — it's the timestamp drift that fails the check.
    expect(verifyWebhookSignature(secret, body, header)).toBe(false);
  });

  it('malformed headers are rejected', () => {
    // Missing v1.
    expect(verifyWebhookSignature(secret, body, 't=1234567890')).toBe(false);
    // Missing t.
    expect(verifyWebhookSignature(secret, body, 'v1=deadbeef')).toBe(false);
    // Garbage with no '='.
    expect(verifyWebhookSignature(secret, body, 'garbage')).toBe(false);
    // Empty string.
    expect(verifyWebhookSignature(secret, body, '')).toBe(false);
    // Non-numeric timestamp.
    expect(verifyWebhookSignature(secret, body, 't=notanumber,v1=deadbeef')).toBe(false);
  });

  it('buildSignedPayload concatenates timestamp + body with a dot', () => {
    expect(buildSignedPayload(123, 'hello')).toBe('123.hello');
  });
});
