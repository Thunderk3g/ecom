import crypto from 'node:crypto';
import { env } from './env';

const SECRET = Buffer.from(env.SESSION_SECRET, 'utf8');

export function sign(value: string): string {
  const mac = crypto.createHmac('sha256', SECRET).update(value).digest('base64url');
  return `${value}.${mac}`;
}

export function unsign(signed: string): string | null {
  const idx = signed.lastIndexOf('.');
  if (idx < 0) return null;
  const value = signed.slice(0, idx);
  const mac = signed.slice(idx + 1);
  const expected = crypto.createHmac('sha256', SECRET).update(value).digest('base64url');
  if (mac.length !== expected.length) return null;
  if (!crypto.timingSafeEqual(Buffer.from(mac), Buffer.from(expected))) return null;
  return value;
}

export const SESSION_COOKIE = 'sid';
export const sessionCookieOptions = {
  httpOnly: true,
  secure: env.NODE_ENV === 'production',
  sameSite: 'lax' as const,
  path: '/',
  domain: env.COOKIE_DOMAIN,
  maxAge: 60 * 60 * 24 * 30, // 30 days
};
