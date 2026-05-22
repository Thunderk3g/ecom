import { describe, it, expect } from 'vitest';
import { hashPassword, verifyPassword } from '@/modules/auth/password';

describe('password', () => {
  it('hashes and verifies a password', async () => {
    const hash = await hashPassword('hunter2!');
    expect(hash).toMatch(/^\$argon2id\$/);
    expect(await verifyPassword(hash, 'hunter2!')).toBe(true);
    expect(await verifyPassword(hash, 'wrong')).toBe(false);
  });
});
