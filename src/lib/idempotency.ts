import Redis from 'ioredis';
import { env } from './env';

const redis = new Redis(env.REDIS_URL);
const TTL_SECONDS = 60 * 60 * 24; // 24h

const K = (scope: string, key: string) => `idem:${scope}:${key}`;

export async function withIdempotency<T>(
  scope: string,
  key: string,
  fn: () => Promise<T>,
): Promise<T> {
  const cached = await redis.get(K(scope, key));
  if (cached) return JSON.parse(cached) as T;
  const result = await fn();
  await redis.set(K(scope, key), JSON.stringify(result), 'EX', TTL_SECONDS, 'NX');
  return result;
}
