import { NextResponse } from 'next/server';
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { migratorDb } from '@/db/client';
import { users } from '@/db/schema/identity';
import { verifyPassword } from '@/modules/auth/password';
import { createSession } from '@/modules/auth/session';
import { SESSION_COOKIE, sessionCookieOptions, sign } from '@/lib/cookies';
import { problem } from '@/lib/errors';
import { withRateLimit } from '@/lib/rate-limit';

const body = z.object({ email: z.string().email(), password: z.string().min(1) });

export async function POST(req: Request) {
  // Brute-force protection: tight per-IP limit on this sensitive endpoint.
  const limited = await withRateLimit(req, { limit: 10, windowSeconds: 60 });
  if (limited) return limited;

  const parsed = body.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return problem(400, 'invalid-body', 'Invalid login body', parsed.error.issues);

  const [u] = await migratorDb.select().from(users).where(eq(users.email, parsed.data.email)).limit(1);
  const ok = u ? await verifyPassword(u.passwordHash, parsed.data.password) : false;
  if (!u || !ok) return problem(401, 'invalid-credentials', 'Invalid email or password', []);

  const session = await createSession(u.id, {
    ip: req.headers.get('x-forwarded-for') ?? undefined,
    userAgent: req.headers.get('user-agent') ?? undefined,
  });
  const res = NextResponse.json({ userId: u.id });
  res.cookies.set(SESSION_COOKIE, sign(session.id), sessionCookieOptions);
  return res;
}
