import 'server-only';
import { headers, cookies } from 'next/headers';
import { resolveTenant } from '@/modules/tenant/resolve';
import { validateSession } from '@/modules/auth/session';
import { getStoreMembership, hasPermission, type StoreMembership } from '@/modules/auth/rbac';
import { mintCsrfToken } from '@/modules/auth/csrf';
import { SESSION_COOKIE, unsign } from '@/lib/cookies';

/**
 * Server-only admin context for the assets subtree.
 *
 * Local to assets/_lib so it does not collide with the SP-6-owned
 * `(protected)/_lib/context.ts`. Mirrors the resolution pipeline used by the
 * protected layout: resolve tenant from the host header, validate the signed
 * session cookie, and load the store membership for RBAC checks.
 *
 * Also mints a CSRF token bound to the current session id so client components
 * (the upload flow) can call the CSRF-gated admin media routes. The session
 * cookie is httpOnly, so the browser cannot mint this itself.
 */
export interface AssetsAdminContext {
  storeId: string;
  userId: string;
  sessionId: string;
  membership: StoreMembership;
  csrfToken: string;
}

export class AdminContextError extends Error {}

export async function getAssetsAdminContext(): Promise<AssetsAdminContext> {
  const h = await headers();
  const host = h.get('x-store-host') ?? h.get('host') ?? '';
  const storeId = host ? await resolveTenant(host) : null;
  if (!storeId) throw new AdminContextError('Unknown store host');

  const jar = await cookies();
  const raw = jar.get(SESSION_COOKIE)?.value;
  const sessionId = raw ? unsign(raw) : null;
  const session = sessionId ? await validateSession(sessionId) : null;
  if (!sessionId || !session) throw new AdminContextError('Not authenticated');

  const membership = await getStoreMembership(storeId, session.userId);
  if (!membership) throw new AdminContextError('Not a member of this store');

  return {
    storeId,
    userId: session.userId,
    sessionId,
    membership,
    csrfToken: mintCsrfToken(sessionId),
  };
}

/** Throw unless the current context holds the required permission. */
export function assertPermission(ctx: AssetsAdminContext, required: string): void {
  if (!hasPermission(ctx.membership.permissions, required)) {
    throw new AdminContextError(`Missing permission: ${required}`);
  }
}
