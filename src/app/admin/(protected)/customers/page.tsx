import { getAdminContext } from '../_lib/context';
import { PageHeader, CursorPager } from '../_lib/ui';
import { listCustomers } from '@/modules/customers/customers';
import { withTenant } from '@/modules/tenant/with-tenant';
import { orders } from '@/db/schema/orders';
import { count, inArray } from 'drizzle-orm';
import { CustomersTable, type CustomerListRow } from './CustomersTable';
import { CustomersFilters } from './CustomersFilters';

export const dynamic = 'force-dynamic';

export default async function CustomersPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const { storeId } = await getAdminContext();
  const params = await searchParams;

  const email = params.email || undefined;
  const after = params.after || undefined;

  const result = await listCustomers(storeId, {
    ...(email ? { email } : {}),
    ...(after ? { cursor: after } : {}),
    limit: 50,
  });

  // Aggregate order count per visible customer in one query. Lifetime value is
  // already maintained on the customer row (lifetimeValueCents), so we don't
  // need to recompute it here — it tracks the sum of paid orders.
  const ids = result.items.map(c => c.id);
  const orderCountById = new Map<string, number>();
  if (ids.length > 0) {
    const aggRows = await withTenant(storeId, async tx =>
      tx
        .select({ customerId: orders.customerId, n: count() })
        .from(orders)
        .where(inArray(orders.customerId, ids))
        .groupBy(orders.customerId),
    );
    for (const r of aggRows) {
      if (r.customerId) orderCountById.set(r.customerId, Number(r.n));
    }
  }

  const rows: CustomerListRow[] = result.items.map(c => {
    const local = c.email.split('@')[0];
    return {
      id: c.id,
      email: c.email,
      name: local && local.length > 0 ? local : c.email,
      locale: c.locale,
      orderCount: orderCountById.get(c.id) ?? 0,
      lifetimeValueCents: c.lifetimeValueCents,
      createdAt: c.createdAt.toISOString(),
    };
  });

  return (
    <div className="space-y-4">
      <PageHeader
        title="Customers"
        description="Storefront customers, addresses, and order history."
      />

      <CustomersFilters email={email ?? ''} />

      <CustomersTable rows={rows} />

      <CursorPager
        basePath="/admin/customers"
        nextCursor={result.nextCursor}
        params={{ email }}
      />
    </div>
  );
}
