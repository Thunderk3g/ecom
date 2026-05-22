import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import Redis from 'ioredis';
import { withIdempotency } from '@/lib/idempotency';

const redis = new Redis(process.env.REDIS_URL!);

describe('withIdempotency', () => {
  beforeEach(async () => { await redis.flushdb(); });
  afterAll(async () => { await redis.quit(); });

  it('executes body on first call and caches result', async () => {
    let calls = 0;
    const run = () => withIdempotency('scope', 'key-1', async () => { calls++; return { ok: true, n: calls }; });
    const a = await run();
    const b = await run();
    expect(calls).toBe(1);
    expect(a).toEqual(b);
  });

  it('different keys run independently', async () => {
    let calls = 0;
    const r1 = await withIdempotency('scope', 'k1', async () => ({ id: ++calls }));
    const r2 = await withIdempotency('scope', 'k2', async () => ({ id: ++calls }));
    expect(r1.id).toBe(1);
    expect(r2.id).toBe(2);
  });
});
