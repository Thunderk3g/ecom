import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { resetAndMigrate, tableExists } from './_setup/db';
import { migratorClient } from '@/db/client';

describe('identity schema', () => {
  beforeAll(async () => { await resetAndMigrate(); });
  afterAll(async () => { await migratorClient.end(); });

  it.each(['users', 'store_users', 'customers', 'addresses'])('creates %s', async (name) => {
    expect(await tableExists(name)).toBe(true);
  });

  it('enforces unique email on users', async () => {
    await migratorClient`INSERT INTO users (email, password_hash) VALUES ('a@x.com', 'h')`;
    await expect(
      migratorClient`INSERT INTO users (email, password_hash) VALUES ('a@x.com', 'h')`
    ).rejects.toThrow();
  });
});
