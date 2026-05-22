import crypto from 'node:crypto';
import { eq, and, gt } from 'drizzle-orm';
import { migratorDb } from '@/db/client';
import { sessions } from '@/db/schema/sessions';

const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 30; // 30 days

function newSessionId(): string {
  return crypto.randomBytes(32).toString('hex');
}

export async function createSession(
  userId: string,
  meta: { ip?: string; userAgent?: string },
): Promise<{ id: string; expiresAt: Date }> {
  const id = newSessionId();
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
  await migratorDb.insert(sessions).values({
    id, userId, expiresAt, ip: meta.ip, userAgent: meta.userAgent,
  });
  return { id, expiresAt };
}

export async function validateSession(id: string): Promise<{ userId: string } | null> {
  const rows = await migratorDb
    .select({ userId: sessions.userId, expiresAt: sessions.expiresAt })
    .from(sessions)
    .where(and(eq(sessions.id, id), gt(sessions.expiresAt, new Date())))
    .limit(1);
  return rows[0] ? { userId: rows[0].userId } : null;
}

export async function invalidateSession(id: string): Promise<void> {
  await migratorDb.delete(sessions).where(eq(sessions.id, id));
}
