import 'server-only';
import { redirect } from 'next/navigation';
import { cookies } from 'next/headers';
import type { ReactNode } from 'react';
import { SESSION_COOKIE, unsign } from '@/lib/cookies';
import { validateSession } from '@/modules/auth/session';
import { getCustomerByUserId } from '@/modules/customers/customers';
import { getStoreContext } from '../_lib/context';

/**
 * Auth guard for all `/account/*` routes.
 *
 * Mirrors the customer-surface API auth shape (`src/app/api/v1/customer/_lib.ts`):
 *   1. Tenant context — resolved through `getStoreContext()`. Unknown hosts are
 *      already handled there (`notFound()`).
 *   2. Active session — the signed `sid` cookie must verify AND map to an
 *      un-expired session row.
 *   3. A `customers` row must exist for that user in this tenant.
 *
 * On any miss we redirect to `/` rather than `/login` (no storefront login route
 * exists yet; admin login at `/admin/login` is a different surface). The home
 * page's site-config-driven CTA is the closest available entry point.
 *
 * Children render server-side and may re-resolve the session via the shared
 * `getAccountContext()` helper in `./_lib.ts`, but the guard above is the
 * authoritative redirect.
 */
export default async function AccountLayout({
  children,
}: {
  children: ReactNode;
}) {
  const { storeId } = await getStoreContext();

  const jar = await cookies();
  const signed = jar.get(SESSION_COOKIE)?.value;
  if (!signed) redirect('/');
  const sessionId = unsign(signed);
  if (!sessionId) redirect('/');
  const session = await validateSession(sessionId);
  if (!session) redirect('/');
  const customer = await getCustomerByUserId(storeId, session.userId);
  if (!customer) redirect('/');

  return <div className="container py-10">{children}</div>;
}
