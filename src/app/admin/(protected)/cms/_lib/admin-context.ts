import 'server-only';
import { headers, cookies } from 'next/headers';
import { resolveTenant } from '@/modules/tenant/resolve';
import { validateSession } from '@/modules/auth/session';
import { getStoreMembership, hasPermission, type StoreMembership } from '@/modules/auth/rbac';
import { SESSION_COOKIE, unsign } from '@/lib/cookies';

/**
 * Server-only admin context for the CMS subtree.
 *
 * Local to cms/_lib so it does not collide with the SP-6-owned
 * `(protected)/_lib/context.ts`. Mirrors the resolution pipeline used by the
 * protected layout. CMS mutations run as Server Actions in the same request
 * context, so no browser-facing CSRF token is needed here — the action
 * re-resolves this context and re-checks RBAC before calling module services.
 */
export interface CmsAdminContext {
  storeId: string;
  userId: string;
  sessionId: string;
  membership: StoreMembership;
}

export class AdminContextError extends Error {}

export async function getCmsAdminContext(): Promise<CmsAdminContext> {
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

  return { storeId, userId: session.userId, sessionId, membership };
}

/** Throw unless the current context holds the required permission. */
export function assertPermission(ctx: CmsAdminContext, required: string): void {
  if (!hasPermission(ctx.membership.permissions, required)) {
    throw new AdminContextError(`Missing permission: ${required}`);
  }
}
