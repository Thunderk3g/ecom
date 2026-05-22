import { hash, verify, Algorithm } from '@node-rs/argon2';

// Algorithm.Argon2id === 2; literal used because `isolatedModules: true`
// forbids accessing values from ambient const enums.
const params = {
  algorithm: 2 satisfies Algorithm,
  memoryCost: 19456, // 19 MiB (OWASP 2024 minimum)
  timeCost: 2,
  outputLen: 32,
  parallelism: 1,
};

export async function hashPassword(plain: string): Promise<string> {
  return hash(plain, params);
}

export async function verifyPassword(stored: string, plain: string): Promise<boolean> {
  try { return await verify(stored, plain); } catch { return false; }
}
