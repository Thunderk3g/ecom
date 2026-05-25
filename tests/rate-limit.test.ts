import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import Redis from 'ioredis';
import { rateLimit, withRateLimit, clientIp } from '@/lib/rate-limit';

const redis = new Redis(process.env.REDIS_URL!);

afterAll(async () => { await redis.quit(); });

describe('rateLimit (sliding window)', () => {
  beforeEach(async () => { await redis.flushdb(); });

  it('allows up to the limit then blocks', async () => {
    const key = `test:${Date.now()}:allow-then-block`;
    const limit = 5;
    for (let i = 0; i < limit; i++) {
      const r = await rateLimit(key, limit, 60);
      expect(r.allowed).toBe(true);
      expect(r.remaining).toBe(limit - (i + 1));
    }
    const over = await rateLimit(key, limit, 60);
    expect(over.allowed).toBe(false);
    expect(over.remaining).toBe(0);
  });

  it('frees the window after it elapses', async () => {
    const key = `test:${Date.now()}:window-reset`;
    // window of 1 second, limit 2
    expect((await rateLimit(key, 2, 1)).allowed).toBe(true);
    expect((await rateLimit(key, 2, 1)).allowed).toBe(true);
    expect((await rateLimit(key, 2, 1)).allowed).toBe(false);

    // Wait past the window; old hits drop out of the sorted set.
    await new Promise((resolve) => setTimeout(resolve, 1100));
    expect((await rateLimit(key, 2, 1)).allowed).toBe(true);
  });

  it('reports a resetAt in the future when blocked', async () => {
    const key = `test:${Date.now()}:reset-at`;
    await rateLimit(key, 1, 60);
    const blocked = await rateLimit(key, 1, 60);
    expect(blocked.allowed).toBe(false);
    expect(blocked.resetAt).toBeGreaterThan(Date.now());
  });
});

describe('clientIp', () => {
  it('prefers the first x-forwarded-for entry', () => {
    const req = new Request('http://x/', { headers: { 'x-forwarded-for': '1.2.3.4, 5.6.7.8' } });
    expect(clientIp(req)).toBe('1.2.3.4');
  });

  it('falls back to unknown when no proxy headers', () => {
    expect(clientIp(new Request('http://x/'))).toBe('unknown');
  });
});

describe('withRateLimit', () => {
  beforeEach(async () => { await redis.flushdb(); });

  it('returns null while under budget then a 429 problem once over', async () => {
    const ip = `9.9.9.${Math.floor(Math.random() * 250)}`;
    const make = () =>
      new Request('http://x/api/v1/thing', { headers: { 'x-forwarded-for': ip } });

    const first = await withRateLimit(make(), { limit: 2, windowSeconds: 60 });
    expect(first).toBeNull();
    const second = await withRateLimit(make(), { limit: 2, windowSeconds: 60 });
    expect(second).toBeNull();

    const third = await withRateLimit(make(), { limit: 2, windowSeconds: 60 });
    expect(third).not.toBeNull();
    expect(third?.status).toBe(429);
    expect(third?.headers.get('Retry-After')).toBeTruthy();
    expect(third?.headers.get('X-RateLimit-Limit')).toBe('2');
    const body = await third?.json();
    expect(body).toMatchObject({ title: 'too-many-requests', status: 429 });
  });

  it('isolates buckets per key', async () => {
    const a = new Request('http://x/', { headers: { 'x-forwarded-for': '10.0.0.1' } });
    const b = new Request('http://x/', { headers: { 'x-forwarded-for': '10.0.0.2' } });
    expect(await withRateLimit(a, { limit: 1, windowSeconds: 60 })).toBeNull();
    // second hit on the SAME ip is blocked, but a different ip is fresh
    expect(await withRateLimit(a, { limit: 1, windowSeconds: 60 })).not.toBeNull();
    expect(await withRateLimit(b, { limit: 1, windowSeconds: 60 })).toBeNull();
  });
});
