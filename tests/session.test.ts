import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { resetAndMigrate } from './_setup/db';
import { migratorClient } from '@/db/client';
import { hashPassword } from '@/modules/auth/password';
import { createSession, validateSession, invalidateSession } from '@/modules/auth/session';

describe('session', () => {
  let userId: string;
  beforeAll(async () => {
    await resetAndMigrate();
    await migratorClient`INSERT INTO users (email, password_hash) VALUES ('u@x.com', ${await hashPassword('p')})`;
    const rows = await migratorClient<{ id: string }[]>`SELECT id FROM users`;
    userId = rows[0]!.id;
  });
  afterAll(async () => { await migratorClient.end(); });

  it('create → validate returns user id', async () => {
    const { id } = await createSession(userId, { ip: '127.0.0.1', userAgent: 'vitest' });
    const result = await validateSession(id);
    expect(result?.userId).toBe(userId);
  });

  it('invalidate removes the session', async () => {
    const { id } = await createSession(userId, {});
    await invalidateSession(id);
    expect(await validateSession(id)).toBeNull();
  });

  it('expired sessions are treated as invalid', async () => {
    const { id } = await createSession(userId, {});
    await migratorClient`UPDATE sessions SET expires_at = now() - interval '1 minute' WHERE id = ${id}`;
    expect(await validateSession(id)).toBeNull();
  });
});
