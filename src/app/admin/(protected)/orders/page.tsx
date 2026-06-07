import Link from 'next/link';
import { getAdminContext } from '../_lib/context';
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

  const nextHref = buildNextHref(result.nextCursor, {
    status,
    customerEmail,
    from: fromStr || undefined,
    to: toStr || undefined,
  });

  return (
    <>
      <div className="between" style={{ marginBottom: 20 }}>
        <div>
          <h2 className="h-md" style={{ fontFamily: 'var(--serif)' }}>
            Orders
          </h2>
          <span className="t-sub">All customer orders for this storefront.</span>
        </div>
      </div>

      <div className="panel">
        <OrdersFilters
          status={status ?? ''}
          customerEmail={customerEmail ?? ''}
          from={fromStr}
          to={toStr}
        />

        <OrdersTable rows={rows} />

        {nextHref ? (
          <div className="pager">
            <span>Showing {rows.length} orders</span>
            <div className="pg">
              <Link href={nextHref} className="row-act">
                Next ›
              </Link>
            </div>
          </div>
        ) : null}
      </div>
    </>
  );
}

/**
 * Builds the cursor "next page" href, carrying active filters across the hop.
 * Returns null when there is no next cursor (mirrors CursorPager's behavior).
 */
function buildNextHref(
  nextCursor: string | null,
  params: Record<string, string | undefined>,
): Parameters<typeof Link>[0]['href'] | null {
  if (!nextCursor) return null;
  const search = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== '') search.set(k, v);
  }
  search.set('after', nextCursor);
  return `/admin/orders?${search.toString()}` as Parameters<
    typeof Link
  >[0]['href'];
}
