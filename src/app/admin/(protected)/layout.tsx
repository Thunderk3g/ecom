import type { ReactNode } from 'react';
import { headers, cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { eq } from 'drizzle-orm';
import { migratorDb } from '@/db/client';
import { users } from '@/db/schema/identity';
import { stores } from '@/db/schema/tenancy';
import { resolveTenant } from '@/modules/tenant/resolve';
import { validateSession } from '@/modules/auth/session';
import { getStoreMembership } from '@/modules/auth/rbac';
import { SESSION_COOKIE, unsign } from '@/lib/cookies';
import { AdminShell } from '@/components/admin/AdminShell';

/**
 * Protected admin route-group layout + auth guard (server component).
 *
 * Lives in the `(protected)` route group so /admin/login (which sits OUTSIDE
 * this group) is not subject to the guard and cannot redirect-loop.
 *
 * Pipeline:
 *   1. resolve tenant from x-store-host
 *   2. read + unsign the session cookie, validate the session row
 *   3. confirm the user is a member of this store (owner/manager/staff)
 * Any failure redirects to /admin/login. On success the AdminShell renders with
 * the store name, the user's email, and their permission set (which drives the
 * visible sidebar entries).
 *
 * Route handlers like admin/metrics/route.ts are unaffected by layouts.
 */
export default async function ProtectedAdminLayout({
  children,
}: {
  children: ReactNode;
}) {
  const h = await headers();
  const host = h.get('x-store-host') ?? '';
  const storeId = host ? await resolveTenant(host) : null;
  if (!storeId) redirect('/admin/login');

  const jar = await cookies();
  const raw = jar.get(SESSION_COOKIE)?.value;
  const sessionId = raw ? unsign(raw) : null;
  const session = sessionId ? await validateSession(sessionId) : null;
  if (!session) redirect('/admin/login');

  const membership = await getStoreMembership(storeId, session.userId);
  if (!membership) redirect('/admin/login');

  const [user] = await migratorDb
    .select({ email: users.email })
    .from(users)
    .where(eq(users.id, session.userId))
    .limit(1);
  const [store] = await migratorDb
    .select({ name: stores.name })
    .from(stores)
    .where(eq(stores.id, storeId))
    .limit(1);

  return (
    <AdminShell
      storeName={store?.name ?? 'Admin'}
      user={{ email: user?.email ?? 'admin', permissions: membership.permissions }}
    >
      {children}
    </AdminShell>
  );
}
