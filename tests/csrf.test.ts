import { describe, it, expect } from 'vitest';
import { mintCsrfToken, verifyCsrfToken } from '@/modules/auth/csrf';

describe('csrf', () => {
  it('mint → verify roundtrips for the same session', () => {
    const t = mintCsrfToken('sess-1');
    expect(verifyCsrfToken('sess-1', t)).toBe(true);
  });

  it('rejects a token from a different session', () => {
    const t = mintCsrfToken('sess-1');
    expect(verifyCsrfToken('sess-2', t)).toBe(false);
  });

  it('rejects garbage', () => {
    expect(verifyCsrfToken('sess-1', 'nope')).toBe(false);
    expect(verifyCsrfToken('sess-1', '')).toBe(false);
  });
});
