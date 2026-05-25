import { describe, it, expect } from 'vitest';
import { signPreviewToken, verifyPreviewToken } from '@/modules/cms/preview';

const PAGE = '11111111-1111-1111-1111-111111111111';
const VERSION = '22222222-2222-2222-2222-222222222222';

describe('cms preview tokens — sign + verify', () => {
  it('round-trips pageId and versionId', () => {
    const token = signPreviewToken(PAGE, VERSION);
    const result = verifyPreviewToken(token);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.payload.pageId).toBe(PAGE);
      expect(result.payload.versionId).toBe(VERSION);
    }
  });

  it('rejects a tampered signature', () => {
    const token = signPreviewToken(PAGE, VERSION);
    const tampered = token.slice(0, -1) + (token.endsWith('a') ? 'b' : 'a');
    const result = verifyPreviewToken(tampered);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('bad_signature');
  });

  it('rejects a tampered payload (signature no longer matches)', () => {
    const token = signPreviewToken(PAGE, VERSION);
    const [, sig] = token.split('.');
    const forgedPayload = Buffer.from(
      JSON.stringify({ pageId: PAGE, versionId: 'evil', exp: Math.floor(Date.now() / 1000) + 300 }),
      'utf8',
    ).toString('base64url');
    const result = verifyPreviewToken(`${forgedPayload}.${sig}`);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('bad_signature');
  });

  it('rejects an expired token', () => {
    const now = Date.now();
    const token = signPreviewToken(PAGE, VERSION, { ttlSeconds: 300, now });
    // 5 minutes + 1 second later.
    const result = verifyPreviewToken(token, { now: now + 301 * 1000 });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('expired');
  });

  it('accepts a token still inside its 5-minute window', () => {
    const now = Date.now();
    const token = signPreviewToken(PAGE, VERSION, { now });
    const result = verifyPreviewToken(token, { now: now + 4 * 60 * 1000 });
    expect(result.ok).toBe(true);
  });

  it('rejects a malformed token', () => {
    expect(verifyPreviewToken('garbage').ok).toBe(false);
    expect(verifyPreviewToken('').ok).toBe(false);
    expect(verifyPreviewToken('only.').ok).toBe(false);
  });
});
