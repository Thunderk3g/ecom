/**
 * Role-based access control helpers for admin endpoints.
 *
 * The admin catalog routes (SP-2 Stream D) follow a uniform pipeline:
 *
 *   1. resolveTenant(host)        — 404 if unknown
 *   2. getSessionFromRequest(req) — 401 if not authenticated
 *   3. requireStorePermission(...) — 403 if the user isn't a member of the
 *                                    store or lacks the required permission
 *   4. requireCsrf(req, sessionId) — 403 (mutations only)
 *   5. requireIdempotencyKey(req)  — 400 (mutations only)
 *
 * These helpers don't construct HTTP responses. They throw a typed error
 * (or return `null`) and the route handler maps the result to `problem(...)`.
 */
import { and, eq } from 'drizzle-orm';
import { migratorDb } from '@/db/client';
import { storeUsers } from '@/db/schema/identity';
import { SESSION_COOKIE, unsign } from '@/lib/cookies';
import { validateSession } from './session';

export type Session = { id: string; userId: string };

export type StoreMembership = {
  userId: string;
  role: 'owner' | 'manager' | 'staff' | string;
  permissions: string[];
};

const ALLOWED_ROLES = new Set(['owner', 'manager', 'staff']);

/**
 * Read the signed session cookie off the incoming Request and resolve it to
 * an active session row. Returns `null` when:
 *  - the cookie is missing,
 *  - the cookie's HMAC fails verification,
 *  - or the session row doesn't exist / is expired.
 *
 * Does NOT throw on missing/invalid cookies — callers map `null` to 401.
 */
export async function getSessionFromRequest(req: Request): Promise<Session | null> {
  const cookieHeader = req.headers.get('cookie');
  if (!cookieHeader) return null;
  const cookies = parseCookieHeader(cookieHeader);
  const signed = cookies[SESSION_COOKIE];
  if (!signed) return null;
  const sessionId = unsign(signed);
  if (!sessionId) return null;
  const row = await validateSession(sessionId);
  if (!row) return null;
  return { id: sessionId, userId: row.userId };
}

function parseCookieHeader(header: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const piece of header.split(';')) {
    const eq = piece.indexOf('=');
    if (eq < 0) continue;
    const k = piece.slice(0, eq).trim();
    const v = piece.slice(eq + 1).trim();
    if (k) out[k] = decodeURIComponent(v);
  }
  return out;
}

/**
 * Look up the (storeId, userId) membership row. Returns null when the user
 * isn't a member of that store.
 */
export async function getStoreMembership(
  storeId: string,
  userId: string,
): Promise<StoreMembership | null> {
  const rows = await migratorDb
    .select({
      userId: storeUsers.userId,
      role: storeUsers.role,
      permissions: storeUsers.permissions,
    })
    .from(storeUsers)
    .where(and(eq(storeUsers.storeId, storeId), eq(storeUsers.userId, userId)))
    .limit(1);
  const row = rows[0];
  if (!row) return null;
  return {
    userId: row.userId,
    role: row.role,
    permissions: (row.permissions ?? []) as string[],
  };
}

/**
 * Return true when `permissions` grants `required`. Wildcards:
 *  - `*` grants everything
 *  - `<scope>:*` grants any action within that scope (e.g. `catalog:*`
 *    grants `catalog:read`, `catalog:write`, …).
 */
export function hasPermission(permissions: string[], required: string): boolean {
  if (permissions.includes('*')) return true;
  if (permissions.includes(required)) return true;
  const colon = required.indexOf(':');
  if (colon > 0) {
    const scope = required.slice(0, colon);
    if (permissions.includes(`${scope}:*`)) return true;
  }
  return false;
}

export type PermissionCheck =
  | { ok: true; membership: StoreMembership }
  | { ok: false; reason: 'not-a-member' | 'role-not-allowed' | 'permission-denied' };

/**
 * Verify that `userId` is a member of `storeId` with one of the admin roles
 * (owner/manager/staff) AND holds the requested permission (or a wildcard
 * that subsumes it). Returns a discriminated union the caller maps to
 * `problem(403, ...)` on `ok: false`.
 */
export async function requireStorePermission(
  storeId: string,
  userId: string,
  permission: string,
): Promise<PermissionCheck> {
  const membership = await getStoreMembership(storeId, userId);
  if (!membership) return { ok: false, reason: 'not-a-member' };
  if (!ALLOWED_ROLES.has(membership.role)) return { ok: false, reason: 'role-not-allowed' };
  if (!hasPermission(membership.permissions, permission)) {
    return { ok: false, reason: 'permission-denied' };
  }
  return { ok: true, membership };
}
