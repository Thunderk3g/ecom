import { headers, cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { resolveTenant } from '@/modules/tenant/resolve';
import { validateSession } from '@/modules/auth/session';
import {
  getStoreMembership,
  hasPermission,
  type StoreMembership,
} from '@/modules/auth/rbac';
import { SESSION_COOKIE, unsign } from '@/lib/cookies';

/**
 * Resolved admin request context, shared by every protected admin page and
 * Server Action. Mirrors the `(protected)/layout.tsx` guard pipeline so reads
 * and mutations re-derive the same (storeId, session, membership) tuple.
 *
 * Any failure redirects to /admin/login — the same terminal behaviour as the
 * layout guard, so a Server Action that loses its session can't silently
 * operate against the wrong tenant.
 */
export type AdminContext = {
  storeId: string;
  session: { id: string; userId: string };
  membership: StoreMembership;
};

export async function getAdminContext(): Promise<AdminContext> {
  const h = await headers();
  const host = h.get('x-store-host') ?? '';
  const storeId = host ? await resolveTenant(host) : null;
  if (!storeId) redirect('/admin/login');

  const jar = await cookies();
  const raw = jar.get(SESSION_COOKIE)?.value;
  const sessionId = raw ? unsign(raw) : null;
  const validated = sessionId ? await validateSession(sessionId) : null;
  if (!sessionId || !validated) redirect('/admin/login');

  const membership = await getStoreMembership(storeId, validated.userId);
  if (!membership) redirect('/admin/login');

  return {
    storeId,
    session: { id: sessionId, userId: validated.userId },
    membership,
  };
}

/**
 * Server Action permission gate. Re-checks the admin context AND the required
 * permission scope; throws when the caller lacks it (Server Actions surface
 * the thrown error to the client, which the calling form maps to a toast).
 */
export async function requireAdmin(permission: string): Promise<AdminContext> {
  const ctx = await getAdminContext();
  if (!hasPermission(ctx.membership.permissions, permission)) {
    throw new Error(`Forbidden: missing permission ${permission}`);
  }
  return ctx;
}

/** Build the OrderEventActor shape from an admin context. */
export function adminActor(ctx: AdminContext): { actorType: string; actorId: string } {
  return { actorType: 'user', actorId: ctx.session.userId };
}
