import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { resetAndMigrate, tableExists } from './_setup/db';
import { migratorClient } from '@/db/client';

describe('sessions schema', () => {
  beforeAll(async () => { await resetAndMigrate(); });
  afterAll(async () => { await migratorClient.end(); });

  it('creates sessions table', async () => {
    expect(await tableExists('sessions')).toBe(true);
  });

  it('cascades session deletion when user is deleted', async () => {
    await migratorClient`INSERT INTO users (email, password_hash) VALUES ('u@x.com', 'h')`;
    const [u] = await migratorClient<{ id: string }[]>`SELECT id FROM users WHERE email='u@x.com'`;
    await migratorClient`INSERT INTO sessions (id, user_id, expires_at) VALUES ('s1', ${u!.id}, now() + interval '1 day')`;
    await migratorClient`DELETE FROM users WHERE id = ${u!.id}`;
    const rows = await migratorClient`SELECT 1 FROM sessions WHERE id = 's1'`;
    expect(rows.length).toBe(0);
  });
});
