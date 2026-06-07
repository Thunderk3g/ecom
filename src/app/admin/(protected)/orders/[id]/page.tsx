import { notFound } from 'next/navigation';
import { desc, eq, sql } from 'drizzle-orm';
import { getAdminContext } from '../../_lib/context';
import { withTenant } from '@/modules/tenant/with-tenant';
import { orders, orderItems } from '@/db/schema/orders';
import { payments, paymentIntents } from '@/db/schema/payments';
import { fulfillments, fulfillmentItems } from '@/db/schema/fulfillment';
import { refunds, refundItems } from '@/db/schema/refunds';
import { getOrderTimeline } from '@/modules/orders/events';

import { formatDateTime, formatMoney } from '@/lib/format';
import { StatusBadge } from '../_components/StatusBadge';
import { FulfillDialog, type FulfillDialogItem } from '../_components/FulfillDialog';
import { RefundDialog, type RefundDialogItem } from '../_components/RefundDialog';
import { CancelDialog } from '../_components/CancelDialog';
import { ShipmentActions } from '../_components/ShipmentActions';

export const dynamic = 'force-dynamic';

export default async function OrderDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { storeId } = await getAdminContext();
  const { id } = await params;

  const bundle = await withTenant(storeId, async tx => {
    const [order] = await tx.select().from(orders).where(eq(orders.id, id)).limit(1);
    if (!order) return null;

    const items = await tx
      .select()
      .from(orderItems)
      .where(eq(orderItems.orderId, id));

    const paymentRows = await tx
      .select()
      .from(payments)
      .where(eq(payments.orderId, id))
      .orderBy(desc(payments.createdAt));

    let intent: typeof paymentIntents.$inferSelect | null = null;
    const headPayment = paymentRows[0];
    if (headPayment?.intentId) {
      const [row] = await tx
        .select()
        .from(paymentIntents)
        .where(eq(paymentIntents.id, headPayment.intentId))
        .limit(1);
      intent = row ?? null;
    }

    const fulfillmentRows = await tx
      .select()
      .from(fulfillments)
      .where(eq(fulfillments.orderId, id))
      .orderBy(desc(fulfillments.createdAt));

    const fulfillmentItemRows = fulfillmentRows.length
      ? await tx
          .select()
          .from(fulfillmentItems)
          .where(
            sql`${fulfillmentItems.fulfillmentId} IN (${sql.join(
              fulfillmentRows.map(f => sql`${f.id}`),
              sql`, `,
            )})`,
          )
      : [];

    const refundRows = await tx
      .select()
      .from(refunds)
      .where(eq(refunds.orderId, id))
      .orderBy(desc(refunds.createdAt));

    const refundItemRows = refundRows.length
      ? await tx
          .select()
          .from(refundItems)
          .where(
            sql`${refundItems.refundId} IN (${sql.join(
              refundRows.map(r => sql`${r.id}`),
              sql`, `,
            )})`,
          )
      : [];

    return {
      order,
      items,
      payments: paymentRows,
      intent,
      fulfillments: fulfillmentRows,
      fulfillmentItems: fulfillmentItemRows,
      refunds: refundRows,
      refundItems: refundItemRows,
    };
  });

  if (!bundle) notFound();

  const timeline = await getOrderTimeline(storeId, id);

  const {
    order,
    items,
    payments: paymentRows,
    intent,
    fulfillments: fulfillmentRows,
    fulfillmentItems: fulfillmentItemRows,
    refunds: refundRows,
    refundItems: refundItemRows,
  } = bundle;

  const currency = order.currency;

  // Per-item: how many units have been fulfilled across all fulfillments.
  const fulfilledQtyByItem = new Map<string, number>();
  for (const fi of fulfillmentItemRows) {
    fulfilledQtyByItem.set(
      fi.orderItemId,
      (fulfilledQtyByItem.get(fi.orderItemId) ?? 0) + fi.qty,
    );
  }

  const fulfillItems: FulfillDialogItem[] = items.map(it => ({
    orderItemId: it.id,
    sku: it.sku,
    name: it.name,
    remaining: Math.max(0, it.qty - (fulfilledQtyByItem.get(it.id) ?? 0)),
  }));

  const refundDialogItems: RefundDialogItem[] = items.map(it => ({
    orderItemId: it.id,
    sku: it.sku,
    name: it.name,
    qty: it.qty,
    unitPriceCents: it.unitPriceCents,
    lineTotalCents: it.lineTotalCents,
  }));

  // Refundable balance: order total minus refunds that are NOT 'failed'.
  // Mirrors createRefund's available-balance check so the dialog's preview
  // matches what the server will accept.
  const reservedRefundCents = refundRows
    .filter(r => r.status !== 'failed')
    .reduce((s, r) => s + r.amountCents, 0);
  const refundableCents = Math.max(0, order.totalCents - reservedRefundCents);

  // Action availability — based on the lifecycle transition map.
  const canFulfill = order.status === 'paid' && order.fulfillmentStatus !== 'fulfilled';
  const canRefund =
    (order.status === 'paid' ||
      order.status === 'fulfilled' ||
      order.status === 'completed') &&
    refundableCents > 0;
  const canCancel = order.status === 'pending_payment' || order.status === 'paid';

  const refundItemsByRefund = new Map<string, typeof refundItemRows>();
  for (const ri of refundItemRows) {
    const list = refundItemsByRefund.get(ri.refundId) ?? [];
    list.push(ri);
    refundItemsByRefund.set(ri.refundId, list);
  }
  void refundItemsByRefund; // available for future per-refund line breakdown

  return (
    <>
      <div className="between" style={{ marginBottom: 20 }}>
        <div>
          <div className="row" style={{ gap: 10 }}>
            <h2 className="h-md" style={{ fontFamily: 'var(--serif)' }}>
              Order {order.number}
            </h2>
            <StatusBadge status={order.status} />
          </div>
          <span className="t-sub">Placed {formatDateTime(order.placedAt)}</span>
        </div>
        <div className="row" style={{ gap: 10, flexWrap: 'wrap' }}>
          <FulfillDialog
            orderId={order.id}
            items={fulfillItems}
            disabled={!canFulfill}
          />
          <RefundDialog
            orderId={order.id}
            items={refundDialogItems}
            currency={currency}
            refundableCents={refundableCents}
            disabled={!canRefund}
          />
          <CancelDialog orderId={order.id} disabled={!canCancel} />
        </div>
      </div>

      <div className="adm-cols">
        {/* Left / main column */}
        <div className="stack" style={{ gap: 16 }}>
          {/* Summary */}
          <div className="panel">
            <div className="panel-head">
              <h3>Summary</h3>
              <div className="row" style={{ gap: 8 }}>
                <StatusBadge status={order.paymentStatus} />
                <StatusBadge status={order.fulfillmentStatus} />
              </div>
            </div>
            <div className="panel-pad">
              <div className="sum-line">
                <span>Subtotal</span>
                <span>{formatMoney(order.subtotalCents, currency)}</span>
              </div>
              <div className="sum-line">
                <span>
                  Discount{order.couponCode ? ` · ${order.couponCode}` : ''}
                </span>
                <span style={{ color: 'var(--good)' }}>
                  −{formatMoney(order.discountCents, currency)}
                </span>
              </div>
              <div className="sum-line">
                <span>Shipping</span>
                <span>{formatMoney(order.shippingCents, currency)}</span>
              </div>
              <div className="sum-line">
                <span>Tax</span>
                <span>{formatMoney(order.taxCents, currency)}</span>
              </div>
              <div className="sum-line total">
                <span>Total</span>
                <span>{formatMoney(order.totalCents, currency)}</span>
              </div>
              {order.note ? (
                <div style={{ marginTop: 12 }}>
                  <div className="t-sub ucap">Note</div>
                  <p className="t-sub" style={{ lineHeight: 1.6 }}>
                    {order.note}
                  </p>
                </div>
              ) : null}
            </div>
          </div>

          {/* Items */}
          <div className="panel">
            <div className="panel-head">
              <h3>Items</h3>
            </div>
            <table className="dtable">
              <thead>
                <tr>
                  <th>Item</th>
                  <th className="num">Qty</th>
                  <th className="num">Unit</th>
                  <th className="num">Line total</th>
                  <th className="num">Tax</th>
                </tr>
              </thead>
              <tbody>
                {items.map(it => (
                  <tr key={it.id}>
                    <td>
                      <div className="t-strong">{it.name}</div>
                      <div className="t-sub">{it.sku}</div>
                    </td>
                    <td className="num t-sub">×{it.qty}</td>
                    <td className="num">
                      {formatMoney(it.unitPriceCents, currency)}
                    </td>
                    <td className="num t-strong">
                      {formatMoney(it.lineTotalCents, currency)}
                    </td>
                    <td className="num t-sub">
                      {formatMoney(it.taxCents, currency)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Payment & transactions */}
          <div className="panel">
            <div className="panel-head">
              <h3>Payment &amp; transactions</h3>
            </div>
            <div className="panel-pad" style={{ paddingBottom: 0 }}>
              {intent ? (
                <div style={{ marginBottom: 8 }}>
                  <div className="t-sub ucap">Intent</div>
                  <div className="t-strong" style={{ fontFamily: 'monospace', fontSize: 12 }}>
                    {intent.id}
                  </div>
                  <div className="t-sub">
                    {intent.provider} · {intent.status}
                    {intent.providerRef ? ` · ${intent.providerRef}` : ''}
                  </div>
                </div>
              ) : (
                <p className="t-sub">No payment intent recorded.</p>
              )}
            </div>
            {paymentRows.length === 0 ? (
              <div className="panel-pad">
                <p className="t-sub">No payments recorded.</p>
              </div>
            ) : (
              <table className="dtable">
                <thead>
                  <tr>
                    <th>Method</th>
                    <th>Status</th>
                    <th>Date</th>
                    <th className="num">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {paymentRows.map(p => (
                    <tr key={p.id}>
                      <td className="t-strong">
                        {p.provider}
                        {p.method ? ` · ${p.method}` : ''}
                        {p.providerRef ? (
                          <div className="t-sub">{p.providerRef}</div>
                        ) : null}
                      </td>
                      <td>
                        <StatusBadge status={p.status} />
                      </td>
                      <td className="t-sub">{formatDateTime(p.createdAt)}</td>
                      <td className="num t-strong">
                        {formatMoney(p.amountCents, currency)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          {/* Fulfillments */}
          <div className="panel">
            <div className="panel-head">
              <h3>Fulfilments</h3>
            </div>
            <div className="panel-pad stack" style={{ gap: 12 }}>
              {fulfillmentRows.length === 0 ? (
                <p className="t-sub">No fulfillments yet.</p>
              ) : (
                fulfillmentRows.map(f => (
                  <div
                    key={f.id}
                    style={{
                      border: '1px solid var(--line)',
                      borderRadius: 'var(--r-sm)',
                      padding: 14,
                    }}
                  >
                    <div className="between">
                      <div>
                        <div
                          className="t-strong"
                          style={{ fontFamily: 'monospace', fontSize: 12 }}
                        >
                          {f.id}
                        </div>
                        <div className="t-sub">
                          {f.carrier ?? '—'} · {f.trackingNumber ?? 'no tracking'}
                        </div>
                      </div>
                      <StatusBadge status={f.status} />
                    </div>
                    <div className="t-sub" style={{ marginTop: 8 }}>
                      {f.shippedAt
                        ? `Shipped ${formatDateTime(f.shippedAt)}`
                        : 'Not shipped'}
                      {f.deliveredAt
                        ? ` · Delivered ${formatDateTime(f.deliveredAt)}`
                        : ''}
                    </div>
                    <ShipmentActions
                      orderId={order.id}
                      fulfillmentId={f.id}
                      status={f.status}
                      carrier={f.carrier}
                      trackingNumber={f.trackingNumber}
                    />
                  </div>
                ))
              )}
            </div>
          </div>

          {/* Refund history */}
          <div className="panel">
            <div className="panel-head">
              <h3>Refund history</h3>
            </div>
            <div className="panel-pad stack" style={{ gap: 12 }}>
              {refundRows.length === 0 ? (
                <p className="t-sub">No refunds recorded.</p>
              ) : (
                refundRows.map(r => (
                  <div
                    key={r.id}
                    style={{
                      border: '1px solid var(--line)',
                      borderRadius: 'var(--r-sm)',
                      padding: 14,
                    }}
                  >
                    <div className="between">
                      <div>
                        <div className="t-strong">
                          {formatMoney(r.amountCents, currency)}
                        </div>
                        <div className="t-sub">
                          {r.providerRef ?? 'no provider ref'} ·{' '}
                          {formatDateTime(r.createdAt)}
                        </div>
                        {r.reason ? (
                          <div className="t-sub">Reason: {r.reason}</div>
                        ) : null}
                      </div>
                      <StatusBadge status={r.status} />
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>

        {/* Right / aside column */}
        <aside className="stack" style={{ gap: 16 }}>
          <div className="panel panel-pad">
            <h3
              style={{
                fontFamily: 'var(--serif)',
                fontSize: 16,
                marginBottom: 10,
              }}
            >
              Customer
            </h3>
            <div className="t-sub" style={{ lineHeight: 1.7, marginBottom: 12 }}>
              {order.email}
            </div>
            <AddressBlock title="Shipping address" address={order.shippingAddress} />
            <div style={{ height: 12 }} />
            <AddressBlock title="Billing address" address={order.billingAddress} />
          </div>

          <div className="panel panel-pad">
            <h3
              style={{
                fontFamily: 'var(--serif)',
                fontSize: 16,
                marginBottom: 18,
              }}
            >
              Event timeline
            </h3>
            {timeline.length === 0 ? (
              <p className="t-sub">No events yet.</p>
            ) : (
              <div className="timeline">
                {timeline.map((ev, i) => (
                  <div
                    key={ev.id}
                    className={`tl-item ${i === 0 ? 'cur' : 'done'}`}
                  >
                    <div className="tl-mark">
                      <span className="tl-dot" />
                      <span className="tl-line" />
                    </div>
                    <div className="tl-body">
                      <div className="t">{ev.kind}</div>
                      <div className="s">
                        {formatDateTime(ev.createdAt)} · {ev.actorType}
                        {ev.actorId ? ` · ${ev.actorId}` : ''}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </aside>
      </div>
    </>
  );
}

type AddressLike = {
  name: string;
  line1: string;
  line2?: string;
  city: string;
  region: string;
  postal: string;
  country: string;
  phone?: string;
} | null;

function AddressBlock({
  title,
  address,
}: {
  title: string;
  address: AddressLike;
}) {
  return (
    <div>
      <div className="t-sub ucap" style={{ marginBottom: 4 }}>
        {title}
      </div>
      {address ? (
        <div className="t-sub" style={{ lineHeight: 1.7 }}>
          {address.name}
          <br />
          {address.line1}
          {address.line2 ? (
            <>
              <br />
              {address.line2}
            </>
          ) : null}
          <br />
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
      ) : (
        <p className="t-sub">Not provided.</p>
      )}
    </div>
  );
}
