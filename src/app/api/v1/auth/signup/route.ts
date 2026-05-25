import { NextResponse } from 'next/server';
import { z } from 'zod';
import { migratorDb } from '@/db/client';
import { users } from '@/db/schema/identity';
import { hashPassword } from '@/modules/auth/password';
import { createSession } from '@/modules/auth/session';
import { SESSION_COOKIE, sessionCookieOptions, sign } from '@/lib/cookies';
import { withRateLimit } from '@/lib/rate-limit';
import { problem } from '@/lib/errors';

const body = z.object({ email: z.string().email(), password: z.string().min(8) });

export async function POST(req: Request) {
  // Per-IP rate limit: 10/min. argon2id is intentionally slow, so an
  // unrestricted signup endpoint is a CPU-exhaustion vector. SP-9 Task 14.
  const limited = await withRateLimit(req, { limit: 10, windowSeconds: 60 });
  if (limited) return limited;

  const parsed = body.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return problem(400, 'invalid-body', 'Invalid signup body', parsed.error.issues);

  const passwordHash = await hashPassword(parsed.data.password);
  try {
    const [u] = await migratorDb.insert(users).values({ email: parsed.data.email, passwordHash }).returning({ id: users.id });
    const session = await createSession(u!.id, {
      ip: req.headers.get('x-forwarded-for') ?? undefined,
      userAgent: req.headers.get('user-agent') ?? undefined,
    });
    const res = NextResponse.json({ userId: u!.id }, { status: 201 });
    res.cookies.set(SESSION_COOKIE, sign(session.id), sessionCookieOptions);
    return res;
  } catch (err: any) {
    if (err?.code === '23505') return problem(409, 'email-taken', 'Email already registered', []);
    throw err;
  }
}
