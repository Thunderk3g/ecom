import { getAdminContext } from '../_lib/context';
import { PageHeader, CursorPager } from '../_lib/ui';
import {
  listOrders,
  type OrderStatus,
} from '@/modules/orders/lifecycle';
import { ORDER_STATUSES } from './_status';
import { OrdersFilters } from './_components/OrdersFilters';
import { OrdersTable, type OrderListRow } from './_components/OrdersTable';

export const dynamic = 'force-dynamic';

const STATUS_SET = new Set<string>(ORDER_STATUSES);

function isOrderStatus(value: string): value is OrderStatus {
  return STATUS_SET.has(value);
}

/**
 * Parse a YYYY-MM-DD string from the date inputs. `from` is the start of day,
 * `to` is the end of day so the inclusive range mirrors how an admin reads it.
 */
function parseDate(value: string | undefined, edge: 'start' | 'end'): Date | undefined {
  if (!value) return undefined;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return undefined;
  if (edge === 'end') {
    d.setHours(23, 59, 59, 999);
  } else {
    d.setHours(0, 0, 0, 0);
  }
  return d;
}

export default async function OrdersPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const { storeId } = await getAdminContext();
  const params = await searchParams;

  const statusParam = params.status ?? '';
  const status = statusParam && isOrderStatus(statusParam) ? statusParam : undefined;
  const customerEmail = params.customerEmail || undefined;
  const fromStr = params.from || '';
  const toStr = params.to || '';
  const from = parseDate(fromStr, 'start');
  const to = parseDate(toStr, 'end');
  const after = params.after || undefined;

  const result = await listOrders(storeId, {
    ...(status ? { status } : {}),
    ...(customerEmail ? { customerEmail } : {}),
    ...(from ? { from } : {}),
    ...(to ? { to } : {}),
    ...(after ? { cursor: after } : {}),
    limit: 50,
  });

  const rows: OrderListRow[] = result.items.map(o => ({
    id: o.id,
    number: o.number,
    email: o.email,
    status: o.status,
    paymentStatus: o.paymentStatus,
    fulfillmentStatus: o.fulfillmentStatus,
    totalCents: o.totalCents,
    currency: o.currency,
    placedAt: o.placedAt.toISOString(),
  }));

  return (
    <div className="space-y-4">
      <PageHeader
        title="Orders"
        description="All customer orders for this storefront."
      />

      <OrdersFilters
        status={status ?? ''}
        customerEmail={customerEmail ?? ''}
        from={fromStr}
        to={toStr}
      />

      <OrdersTable rows={rows} />

      <CursorPager
        basePath="/admin/orders"
        nextCursor={result.nextCursor}
        params={{
          status,
          customerEmail,
          from: fromStr || undefined,
          to: toStr || undefined,
        }}
      />
    </div>
  );
}
