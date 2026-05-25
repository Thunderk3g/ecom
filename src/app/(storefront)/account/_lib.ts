import 'server-only';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { SESSION_COOKIE, unsign } from '@/lib/cookies';
import { validateSession } from '@/modules/auth/session';
import {
  getCustomerByUserId,
  type CustomerRow,
} from '@/modules/customers/customers';
import { getStoreContext, type StoreContext } from '../_lib/context';

/**
 * Resolve the storefront context (tenant + site_config) together with the
 * authenticated customer record. The `account/layout.tsx` guard already
 * redirects on missing auth; we re-validate here so individual pages can call
 * this without smuggling props through the layout.
 *
 * Redirects to `/` when no customer session — same fallback the layout guard
 * uses (no storefront `/login` route exists yet).
 */
export type AccountContext = StoreContext & {
  sessionId: string;
  userId: string;
  customer: CustomerRow;
};

export async function getAccountContext(): Promise<AccountContext> {
  const ctx = await getStoreContext();

  const jar = await cookies();
  const signed = jar.get(SESSION_COOKIE)?.value;
  if (!signed) redirect('/');
  const sessionId = unsign(signed);
  if (!sessionId) redirect('/');
  const session = await validateSession(sessionId);
  if (!session) redirect('/');
  const customer = await getCustomerByUserId(ctx.storeId, session.userId);
  if (!customer) redirect('/');

  return {
    ...ctx,
    sessionId,
    userId: session.userId,
    customer,
  };
}
