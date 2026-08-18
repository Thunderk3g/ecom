/**
 * mediaOrigins() — the browser-reachable origins the CSP must allow for the
 * active MediaProvider.
 *
 * This exists because a `default-src 'self'` CSP silently breaks direct upload:
 * the cross-origin PUT surfaces only as a generic fetch "Network error" and
 * stored images never paint. Both are invisible to server-side tests, so the
 * derivation itself is what gets covered here.
 *
 * `getEnv()` memoises on first access, so each case sets process.env and then
 * imports fresh via vi.resetModules().
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

async function originsWith(vars: Record<string, string | undefined>): Promise<string[]> {
  vi.resetModules();
  for (const [k, v] of Object.entries(vars)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  const { mediaOrigins } = await import('@/modules/media/origins');
  return mediaOrigins();
}

const CLEAR = {
  MEDIA_PROVIDER: undefined,
  SUPABASE_URL: undefined,
  R2_PUBLIC_BASE_URL: undefined,
  IMGPROXY_BASE_URL: undefined,
  R2_ACCOUNT_ID: undefined,
};

beforeEach(async () => {
  await originsWith(CLEAR);
});

describe('mediaOrigins', () => {
  it('is empty for the stub provider (uploads are same-origin)', async () => {
    expect(await originsWith({ ...CLEAR, MEDIA_PROVIDER: 'stub' })).toEqual([]);
  });

  it('defaults to empty when MEDIA_PROVIDER is unset', async () => {
    expect(await originsWith({ ...CLEAR })).toEqual([]);
  });

  it('returns the Supabase project origin, without the path', async () => {
    const origins = await originsWith({
      ...CLEAR,
      MEDIA_PROVIDER: 'supabase-storage',
      SUPABASE_URL: 'https://abc123.supabase.co/storage/v1',
    });
    expect(origins).toEqual(['https://abc123.supabase.co']);
  });

  it('covers upload, public-read and derivative origins for r2-imgproxy', async () => {
    const origins = await originsWith({
      ...CLEAR,
      MEDIA_PROVIDER: 'r2-imgproxy',
      R2_PUBLIC_BASE_URL: 'https://cdn.example.com/bucket',
      IMGPROXY_BASE_URL: 'https://img.example.com',
      R2_ACCOUNT_ID: 'acct1',
    });
    expect(new Set(origins)).toEqual(
      new Set([
        'https://cdn.example.com',
        'https://img.example.com',
        'https://acct1.r2.cloudflarestorage.com',
      ]),
    );
  });

  it('dedupes when several config values share one origin', async () => {
    const origins = await originsWith({
      ...CLEAR,
      MEDIA_PROVIDER: 'r2-imgproxy',
      R2_PUBLIC_BASE_URL: 'https://media.example.com/a',
      IMGPROXY_BASE_URL: 'https://media.example.com/b',
    });
    expect(origins).toEqual(['https://media.example.com']);
  });

  // env.ts validates every *_URL with zod .url(), so those can't be malformed
  // here. R2_ACCOUNT_ID is only .min(1) and gets interpolated into a hostname,
  // so that is the one value that can actually produce an unparseable URL.
  it('skips an unparseable constructed URL rather than emitting a broken CSP', async () => {
    const origins = await originsWith({
      ...CLEAR,
      MEDIA_PROVIDER: 'r2-imgproxy',
      IMGPROXY_BASE_URL: 'https://img.example.com',
      R2_ACCOUNT_ID: 'has space',
    });
    expect(origins).toEqual(['https://img.example.com']);
  });
});
