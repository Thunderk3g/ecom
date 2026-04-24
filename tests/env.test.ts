import { describe, it, expect } from 'vitest';
import { parseEnv } from '@/lib/env';

describe('parseEnv', () => {
  it('parses a valid env object', () => {
    const env = parseEnv({
      NODE_ENV: 'development',
      ROLE: 'web',
      DATABASE_URL: 'postgres://u:p@localhost:5432/db',
      REDIS_URL: 'redis://localhost:6379',
      SESSION_SECRET: 'a'.repeat(32),
      COOKIE_DOMAIN: 'localhost',
    });
    expect(env.ROLE).toBe('web');
    expect(env.NODE_ENV).toBe('development');
  });

  it('rejects short SESSION_SECRET', () => {
    expect(() => parseEnv({
      NODE_ENV: 'development',
      ROLE: 'web',
      DATABASE_URL: 'postgres://u:p@localhost:5432/db',
      REDIS_URL: 'redis://localhost:6379',
      SESSION_SECRET: 'short',
      COOKIE_DOMAIN: 'localhost',
    })).toThrow(/SESSION_SECRET/);
  });

  it('rejects invalid ROLE', () => {
    expect(() => parseEnv({
      NODE_ENV: 'development',
      ROLE: 'bogus',
      DATABASE_URL: 'postgres://u:p@localhost:5432/db',
      REDIS_URL: 'redis://localhost:6379',
      SESSION_SECRET: 'a'.repeat(32),
      COOKIE_DOMAIN: 'localhost',
    })).toThrow(/ROLE/);
  });
});
