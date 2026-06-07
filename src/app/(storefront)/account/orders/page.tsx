import Link from 'next/link';
import { listCustomerOrders } from '@/modules/checkout/orders';
import { formatMoney } from '../../_lib/money';
import { getAccountContext } from '../_lib';
import { AccountNav } from '../_components/AccountNav';
import { OrderStatusBadge } from '../_components/OrderStatusBadge';

export const dynamic = 'force-dynamic';

type SearchParams = {
  after?: string | string[];
};

/**
 * Customer order history (`/account/orders`).
 *
 * Cursor-paginated, newest-first, mirroring the `/api/v1/customer/orders`
 * shape (opaque base64url `after`, hard cap of 200 / default 50 via
 * `parseLimit`). The next-page link is rendered server-side; no client JS.
 */
export default async function OrdersPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const ctx = await getAccountContext();
  const { customer, config } = ctx;

  const params = await searchParams;
  const afterRaw = params.after;
  const after = Array.isArray(afterRaw) ? afterRaw[0] : afterRaw;

  const { items, nextCursor } = await listCustomerOrders(
    ctx.storeId,
    customer.id,
    {
      ...(after ? { cursor: after } : {}),
    },
  );

  return (
    <>
      <div style={{ paddingTop: '6px' }}>
        <span className="eyebrow">Your account</span>
        <h1 className="h-lg" style={{ marginTop: '8px' }}>
          Your <em>orders</em>
        </h1>
      </div>

      <div className="acct-grid">
        <AccountNav current="orders" />

        <div>
          {items.length === 0 ? (
            <div className="surface pad" style={{ textAlign: 'center', padding: '48px 24px' }}>
              <p className="meta" style={{ marginBottom: '14px' }}>No orders yet.</p>
              <Link href="/search" className="btn btn-clay btn-sm">
                Browse the shop
              </Link>
            </div>
          ) : (
            <div className="surface" style={{ overflow: 'hidden' }}>
              <table className="dtable">
                <thead>
                  <tr>
                    <th>Order</th>
                    <th>Date</th>
                    <th>Status</th>
                    <th className="num">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map(order => (
                    <tr key={order.id}>
                      <td>
                        <Link
                          href={`/account/orders/${encodeURIComponent(order.number)}`}
                          className="link-u"
                          style={{ fontWeight: 600 }}
                        >
                          {order.number}
                        </Link>
                      </td>
                      <td className="muted">{formatPlacedAt(order.placedAt)}</td>
                      <td>
                        <OrderStatusBadge status={order.status} />
                      </td>
                      <td className="num" style={{ fontWeight: 600 }}>
                        {formatMoney(order.totalCents, config)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {nextCursor ? (
            <div className="row" style={{ justifyContent: 'flex-end', marginTop: '20px' }}>
              <Link
                href={`/account/orders?after=${encodeURIComponent(nextCursor)}`}
                className="btn btn-ghost btn-sm"
              >
                Next page
              </Link>
            </div>
          ) : null}
        </div>
      </div>
    </>
  );
}

function formatPlacedAt(value: Date): string {
  return new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium' }).format(value);
}
