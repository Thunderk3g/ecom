import { listAddresses } from '@/modules/customers/addresses';
import { getAccountContext } from '../_lib';
import { AccountNav } from '../_components/AccountNav';
import { AddressList } from './_components/AddressList';

export const dynamic = 'force-dynamic';

/**
 * Saved addresses (`/account/addresses`).
 *
 * Server-rendered list with an `AddressList` client island that owns the
 * create / edit dialog, set-default, and delete interactions. All mutations
 * dispatch to the Server Actions in `../actions.ts` (no HTTP fetch from the
 * client; Next's Server Action protocol carries CSRF internally).
 */
export default async function AddressesPage() {
  const ctx = await getAccountContext();
  const addresses = await listAddresses(ctx.storeId, ctx.customer.id);

  return (
    <>
      <div style={{ paddingTop: '6px' }}>
        <span className="eyebrow">Your account</span>
        <h1 className="h-lg" style={{ marginTop: '8px' }}>
          Saved <em>addresses</em>
        </h1>
      </div>

      <div className="acct-grid">
        <AccountNav current="addresses" />

        <div>
          <AddressList addresses={addresses} />
        </div>
      </div>
    </>
  );
}
