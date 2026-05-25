import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { listAddresses } from '@/modules/customers/addresses';
import { getAccountContext } from '../_lib';
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
    <div className="space-y-6">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="font-serif text-3xl font-semibold tracking-tight text-brand">
            Addresses
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Manage your shipping and billing addresses.
          </p>
        </div>
        <Button asChild variant="outline" size="sm">
          <Link href="/account">Back to account</Link>
        </Button>
      </header>

      <AddressList addresses={addresses} />
    </div>
  );
}
