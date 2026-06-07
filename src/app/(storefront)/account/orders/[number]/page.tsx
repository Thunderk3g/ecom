import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getOrderByNumber } from '@/modules/checkout/orders';
import { getOrderTimeline } from '@/modules/orders/events';
import type { Address } from '@/db/schema/carts';
import { formatMoney } from '../../../_lib/money';
import { getAccountContext } from '../../_lib';
import { AccountNav } from '../../_components/AccountNav';
import { OrderStatusBadge } from '../../_components/OrderStatusBadge';

export const dynamic = 'force-dynamic';

type RouteParams = { number: string };

/**
 * Customer-facing order detail (`/account/orders/:number`).
 *
 * Read-only view: items table with snapshot SKU/name/price, billing + shipping
 * address snapshots, summary totals, and the order's append-only event
 * timeline (filtered to events meaningful to the customer — no internal admin
 * notes).
 *
 * Cross-customer order numbers return 404, mirroring the API's behaviour
 * (`src/app/api/v1/customer/orders/[number]/route.ts`) so we don't leak
 * existence of foreign order numbers.
 */
export default async function OrderDetailPage({
  params,
}: {
  params: Promise<RouteParams>;
}) {
  const ctx = await getAccountContext();
  const { customer, config } = ctx;

  const { number } = await params;
  if (!number) notFound();

  const order = await getOrderByNumber(ctx.storeId, number);
  if (!order || order.customerId !== customer.id) notFound();

  const timeline = await getOrderTimeline(ctx.storeId, order.id);
  // Filter to events that make sense to a buyer. Anything not in this set
  // (internal admin notes, raw fulfillment.* duplicates, etc.) is hidden.
  const visibleKinds = new Set([
    'created',
    'paid',
    'fulfilled',
    'shipped',
    'delivered',
    'completed',
    'cancelled',
    'refunded',
  ]);
  const customerTimeline = timeline.filter(ev => visibleKinds.has(ev.kind));
  const lastIndex = customerTimeline.length - 1;

  return (
    <>
      <div className="crumbs" style={{ paddingTop: '6px' }}>
        <Link href="/account">Account</Link>
        <span className="sep">/</span>
        <Link href="/account/orders">Orders</Link>
        <span className="sep">/</span>
        <span style={{ color: 'var(--ink)' }}>{order.number}</span>
      </div>

      <div
        className="between"
        style={{ margin: '16px 0 26px', alignItems: 'flex-end' }}
      >
        <div>
          <h1 className="h-lg">
            Order <em>{order.number}</em>
          </h1>
          <div className="row" style={{ gap: '12px', marginTop: '8px' }}>
            <OrderStatusBadge status={order.status} />
            <span className="meta">Placed {formatPlacedAt(order.placedAt)}</span>
          </div>
        </div>
      </div>

      <div className="acct-grid" style={{ gridTemplateColumns: '1fr 320px' }}>
        <div>
          {/* Tracking timeline */}
          <div className="surface pad" style={{ marginBottom: '22px' }}>
            <h3
              className="h-md"
              style={{ fontFamily: 'var(--serif)', marginBottom: '20px' }}
            >
              Tracking
            </h3>
            {customerTimeline.length === 0 ? (
              <p className="meta">No status updates yet.</p>
            ) : (
              <div className="timeline">
                {customerTimeline.map((ev, i) => (
                  <div
                    key={ev.id}
                    className={`tl-item ${i === lastIndex ? 'cur' : 'done'}`}
                  >
                    <div className="tl-mark">
                      <span className="tl-dot" />
                      {i !== lastIndex ? <span className="tl-line" /> : null}
                    </div>
                    <div className="tl-body">
                      <div className="t" style={{ textTransform: 'capitalize' }}>
                        {ev.kind.replace(/[._]/g, ' ')}
                      </div>
                      <div className="s">{formatTimelineAt(ev.createdAt)}</div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Items */}
          <div className="surface" style={{ overflow: 'hidden' }}>
            <table className="dtable">
              <thead>
                <tr>
                  <th>Item</th>
                  <th className="num">Qty</th>
                  <th className="num">Unit</th>
                  <th className="num">Total</th>
                </tr>
              </thead>
              <tbody>
                {order.items.map(item => (
                  <tr key={item.id}>
                    <td>
                      <div style={{ fontWeight: 600 }}>{item.name}</div>
                      <div className="meta">SKU {item.sku}</div>
                    </td>
                    <td className="num">{item.qty}</td>
                    <td className="num">{formatMoney(item.unitPriceCents, config)}</td>
                    <td className="num" style={{ fontWeight: 600 }}>
                      {formatMoney(item.lineTotalCents, config)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Side: summary + addresses */}
        <aside className="stack" style={{ gap: '16px' }}>
          <div className="surface pad">
            <h4 className="cap muted" style={{ marginBottom: '12px' }}>
              Summary
            </h4>
            <div className="sum-line">
              <span>Subtotal</span>
              <span>{formatMoney(order.subtotalCents, config)}</span>
            </div>
            {order.discountCents > 0 ? (
              <div className="sum-line">
                <span>Discount</span>
                <span style={{ color: 'var(--good)' }}>
                  −{formatMoney(order.discountCents, config)}
                </span>
              </div>
            ) : null}
            <div className="sum-line">
              <span>Tax</span>
              <span>{formatMoney(order.taxCents, config)}</span>
            </div>
            <div className="sum-line">
              <span>Shipping</span>
              <span>{formatMoney(order.shippingCents, config)}</span>
            </div>
            <div className="sum-line total">
              <span>Total</span>
              <span>{formatMoney(order.totalCents, config)}</span>
            </div>
            {order.couponCode ? (
              <p className="meta" style={{ marginTop: '12px' }}>
                Coupon <span style={{ fontWeight: 600 }}>{order.couponCode}</span>
              </p>
            ) : null}
            <div className="sum-line" style={{ marginTop: '6px' }}>
              <span>Payment</span>
              <span style={{ textTransform: 'capitalize' }}>{order.paymentStatus}</span>
            </div>
            <div className="sum-line">
              <span>Fulfillment</span>
              <span style={{ textTransform: 'capitalize' }}>
                {order.fulfillmentStatus.replace(/_/g, ' ')}
              </span>
            </div>
          </div>

          <AddressCard title="Shipping to" address={order.shippingAddress} />
          <AddressCard title="Billing" address={order.billingAddress} />
        </aside>
      </div>
      <div style={{ height: '40px' }} />
    </>
  );
}

function AddressCard({
  title,
  address,
}: {
  title: string;
  address: Address | null;
}) {
  return (
    <div className="surface pad">
      <h4 className="cap muted" style={{ marginBottom: '10px' }}>
        {title}
      </h4>
      {address ? (
        <address style={{ fontStyle: 'normal' }}>
          <div style={{ fontWeight: 600, fontSize: '14px' }}>{address.name}</div>
          <div className="meta" style={{ lineHeight: 1.6, marginTop: '3px' }}>
            {address.line1}
            <br />
            {address.line2 ? (
              <>
                {address.line2}
                <br />
              </>
            ) : null}
            {address.city}, {address.region} {address.postal}
            <br />
            {address.country}
            {address.phone ? (
              <>
                <br />
                {address.phone}
              </>
            ) : null}
          </div>
        </address>
      ) : (
        <p className="meta">No address on file.</p>
      )}
    </div>
  );
}

function formatPlacedAt(value: Date): string {
  return new Intl.DateTimeFormat('en-IN', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(value);
}

function formatTimelineAt(value: Date): string {
  return new Intl.DateTimeFormat('en-IN', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(value);
}
