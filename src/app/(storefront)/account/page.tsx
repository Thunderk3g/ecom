import Link from 'next/link';
import { listCustomerOrders } from '@/modules/checkout/orders';
import { formatMoney } from '../_lib/money';
import { getAccountContext } from './_lib';
import { logoutAction } from './actions';
import { AccountNav } from './_components/AccountNav';
import { OrderStatusBadge } from './_components/OrderStatusBadge';

// Personalised, per-customer view — never cache.
export const dynamic = 'force-dynamic';

/**
 * Customer dashboard (`/account`). Shows a greeting, account summary card,
 * the latest 3 orders, and quick links into the address book + order history.
 * Logout is a Server Action posted from the inline form so no client JS is
 * required for the happy path.
 */
export default async function AccountPage() {
  const ctx = await getAccountContext();
  const { customer, config } = ctx;

  // Latest 3 orders for the dashboard card. The list page (`/account/orders`)
  // handles full pagination; we only need a small slice here.
  const ordersResult = await listCustomerOrders(ctx.storeId, customer.id, {
    limit: 3,
  });
  const recentOrders = ordersResult.items;

  const memberSince = formatJoinDate(customer.createdAt);
  const greetingName = customerDisplayName(customer.email);

  return (
    <>
      <div style={{ paddingTop: '6px' }}>
        <span className="eyebrow">Your account</span>
        <h1 className="h-lg" style={{ marginTop: '8px' }}>
          Hello, <em>{greetingName}</em>
        </h1>
      </div>

      <div className="acct-grid">
        <AccountNav current="overview" logoutAction={logoutAction} />

        <div>
          {/* Stats */}
          <div className="stat-row">
            <div className="surface stat-card">
              <span className="meta">Orders placed</span>
              <div className="v">{ordersResult.items.length === 0 ? '0' : recentOrders.length}</div>
              <span className="meta">Since {memberSince}</span>
            </div>
            <div className="surface stat-card">
              <span className="meta">Member since</span>
              <div className="v" style={{ fontSize: '22px' }}>{memberSince}</div>
              <span className="meta">Thank you for being with us</span>
            </div>
            <div className="surface stat-card">
              <span className="meta">Account</span>
              <div className="v" style={{ fontSize: '22px' }}>Active</div>
              <span className="meta">{customer.email}</span>
            </div>
          </div>

          {/* Account details */}
          <div className="surface pad" style={{ marginBottom: '26px' }}>
            <div className="between" style={{ marginBottom: '16px' }}>
              <h3 className="h-md" style={{ fontFamily: 'var(--serif)' }}>
                Account details
              </h3>
            </div>
            <div className="grid-2" style={{ gap: '18px' }}>
              <div>
                <div className="meta">Email</div>
                <div style={{ fontWeight: 600, marginTop: '3px' }}>{customer.email}</div>
              </div>
              <div>
                <div className="meta">Member since</div>
                <div style={{ fontWeight: 600, marginTop: '3px' }}>{memberSince}</div>
              </div>
              {customer.phone ? (
                <div>
                  <div className="meta">Phone</div>
                  <div style={{ fontWeight: 600, marginTop: '3px' }}>{customer.phone}</div>
                </div>
              ) : null}
            </div>
          </div>

          {/* Recent orders */}
          <div className="between" style={{ margin: '8px 0 14px' }}>
            <h3 className="h-md" style={{ fontFamily: 'var(--serif)' }}>
              Recent orders
            </h3>
            <Link href="/account/orders" className="ucap link-u muted">
              View all
            </Link>
          </div>

          {recentOrders.length === 0 ? (
            <div className="surface pad" style={{ textAlign: 'center', padding: '40px 24px' }}>
              <p className="meta" style={{ marginBottom: '14px' }}>
                You haven&apos;t placed any orders yet.
              </p>
              <Link href="/search" className="btn btn-clay btn-sm">
                Start shopping
              </Link>
            </div>
          ) : (
            <div className="stack" style={{ gap: '12px' }}>
              {recentOrders.map(order => (
                <Link
                  key={order.id}
                  href={`/account/orders/${encodeURIComponent(order.number)}`}
                  className="surface order-card"
                >
                  <div className="order-thumbs">
                    <div className="ph clean" style={{ background: 'linear-gradient(150deg,#EFEADF,#E2D8C5)' }} />
                  </div>
                  <div>
                    <div className="row" style={{ gap: '10px' }}>
                      <strong style={{ fontSize: '14.5px' }}>{order.number}</strong>
                      <OrderStatusBadge status={order.status} />
                    </div>
                    <div className="meta" style={{ marginTop: '4px' }}>
                      {order.items.length} item{order.items.length === 1 ? '' : 's'} · placed{' '}
                      {formatPlacedAt(order.placedAt)}
                    </div>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <div style={{ fontWeight: 600 }}>{formatMoney(order.totalCents, config)}</div>
                    <span className="ucap link-u muted">View →</span>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </div>
      </div>
    </>
  );
}

function customerDisplayName(email: string): string {
  const local = email.split('@')[0] ?? email;
  if (!local) return email;
  return local.charAt(0).toUpperCase() + local.slice(1);
}

function formatJoinDate(value: Date): string {
  return new Intl.DateTimeFormat('en-IN', {
    month: 'long',
    year: 'numeric',
  }).format(value);
}

function formatPlacedAt(value: Date): string {
  return new Intl.DateTimeFormat('en-IN', {
    dateStyle: 'medium',
  }).format(value);
}
