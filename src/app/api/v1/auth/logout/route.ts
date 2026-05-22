import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { SESSION_COOKIE, sessionCookieOptions, unsign } from '@/lib/cookies';
import { invalidateSession } from '@/modules/auth/session';

export async function POST() {
  const store = await cookies();
  const raw = store.get(SESSION_COOKIE)?.value;
  if (raw) {
    const sid = unsign(raw);
    if (sid) await invalidateSession(sid);
  }
  const res = NextResponse.json({ ok: true });
  res.cookies.set(SESSION_COOKIE, '', { ...sessionCookieOptions, maxAge: 0 });
  return res;
}
