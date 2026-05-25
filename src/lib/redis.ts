import Redis, { type RedisOptions } from 'ioredis';
import { env } from './env';

// Shared ioredis factory for BullMQ. BullMQ requires `maxRetriesPerRequest: null`
// on connections handed to its `Queue`/`Worker` constructors (the producer/
// consumer must be able to block on streams indefinitely). Callers that don't
// hand the connection to BullMQ can override this option.
//
// We expose both a singleton (`redis`) for cheap reuse and a `makeRedisConnection`
// factory for cases where an isolated connection is preferable (e.g. each
// `Worker` getting its own to avoid head-of-line blocking on long-running jobs).
const baseOptions: RedisOptions = { maxRetriesPerRequest: null };

export function makeRedisConnection(overrides: RedisOptions = {}): Redis {
  return new Redis(env.REDIS_URL, { ...baseOptions, ...overrides });
}

export const redis: Redis = makeRedisConnection();
