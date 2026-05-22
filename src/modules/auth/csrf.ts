import crypto from 'node:crypto';
import { env } from '@/lib/env';

const SECRET = Buffer.from(env.SESSION_SECRET, 'utf8');

// Token format: <random16bytes-hex>.<hmac(session_id + "." + random)>
export function mintCsrfToken(sessionId: string): string {
  const r = crypto.randomBytes(16).toString('hex');
  const mac = crypto.createHmac('sha256', SECRET).update(`${sessionId}.${r}`).digest('base64url');
  return `${r}.${mac}`;
}

export function verifyCsrfToken(sessionId: string, token: string): boolean {
  const parts = token.split('.');
  if (parts.length !== 2) return false;
  const [r, mac] = parts;
  if (!r || !mac) return false;
  const expected = crypto.createHmac('sha256', SECRET).update(`${sessionId}.${r}`).digest('base64url');
  if (mac.length !== expected.length) return false;
  return crypto.timingSafeEqual(Buffer.from(mac), Buffer.from(expected));
}

export function requireCsrf(req: Request, sessionId: string): boolean {
  const header = req.headers.get('x-csrf-token');
  if (!header) return false;
  return verifyCsrfToken(sessionId, header);
}
