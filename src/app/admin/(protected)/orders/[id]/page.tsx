import { notFound } from 'next/navigation';
import { desc, eq, sql } from 'drizzle-orm';
import { getAdminContext } from '../../_lib/context';
import { PageHeader } from '../../_lib/ui';
import { withTenant } from '@/modules/tenant/with-tenant';
import { orders, orderItems } from '@/db/schema/orders';
import { payments, paymentIntents } from '@/db/schema/payments';
import { fulfillments, fulfillmentItems } from '@/db/schema/fulfillment';
import { refunds, refundItems } from '@/db/schema/refunds';
import { getOrderTimeline } from '@/modules/orders/events';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
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
    <div className="space-y-6">
      <PageHeader
        title={`Order ${order.number}`}
        description={`Placed ${formatDateTime(order.placedAt)}`}
        action={
          <div className="flex flex-wrap gap-2">
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
        }
      />

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-base">Summary</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <div className="flex flex-wrap gap-x-6 gap-y-2">
              <Field label="Status" value={<StatusBadge status={order.status} />} />
              <Field
                label="Payment"
                value={<StatusBadge status={order.paymentStatus} />}
              />
              <Field
                label="Fulfillment"
                value={<StatusBadge status={order.fulfillmentStatus} />}
              />
            </div>
            <Separator />
            <div className="grid grid-cols-2 gap-2">
              <Field label="Subtotal" value={formatMoney(order.subtotalCents, currency)} />
              <Field label="Discount" value={`- ${formatMoney(order.discountCents, currency)}`} />
              <Field label="Shipping" value={formatMoney(order.shippingCents, currency)} />
              <Field label="Tax" value={formatMoney(order.taxCents, currency)} />
              <Field
                label="Total"
                value={<span className="font-semibold">{formatMoney(order.totalCents, currency)}</span>}
              />
              {order.couponCode ? (
                <Field label="Coupon" value={order.couponCode} />
              ) : null}
            </div>
            {order.note ? (
              <>
                <Separator />
                <div>
                  <div className="text-xs uppercase text-muted-foreground">Note</div>
                  <p className="text-sm">{order.note}</p>
                </div>
              </>
            ) : null}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Customer</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <Field label="Email" value={order.email} />
            <Separator />
            <AddressBlock title="Shipping" address={order.shippingAddress} />
            <Separator />
            <AddressBlock title="Billing" address={order.billingAddress} />
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Items</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Item</TableHead>
                <TableHead className="text-right">Qty</TableHead>
                <TableHead className="text-right">Unit</TableHead>
                <TableHead className="text-right">Line total</TableHead>
                <TableHead className="text-right">Tax</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map(it => (
                <TableRow key={it.id}>
                  <TableCell>
                    <div className="font-medium">{it.name}</div>
                    <div className="text-xs text-muted-foreground">{it.sku}</div>
                  </TableCell>
                  <TableCell className="text-right">{it.qty}</TableCell>
                  <TableCell className="text-right">
                    {formatMoney(it.unitPriceCents, currency)}
                  </TableCell>
                  <TableCell className="text-right">
                    {formatMoney(it.lineTotalCents, currency)}
                  </TableCell>
                  <TableCell className="text-right">
                    {formatMoney(it.taxCents, currency)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Payment</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            {intent ? (
              <div className="space-y-1">
                <div className="text-xs uppercase text-muted-foreground">Intent</div>
                <div className="font-mono text-xs">{intent.id}</div>
                <div className="text-xs text-muted-foreground">
                  {intent.provider} · {intent.status}
                  {intent.providerRef ? ` · ${intent.providerRef}` : ''}
                </div>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">No payment intent recorded.</p>
            )}
            <Separator />
            {paymentRows.length === 0 ? (
              <p className="text-sm text-muted-foreground">No payments recorded.</p>
            ) : (
              <div className="space-y-2">
                {paymentRows.map(p => (
                  <div key={p.id} className="rounded-md border p-2">
                    <div className="flex items-center justify-between">
                      <div className="font-medium">
                        {formatMoney(p.amountCents, currency)}
                      </div>
                      <StatusBadge status={p.status} />
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {p.provider}
                      {p.method ? ` · ${p.method}` : ''}
                      {p.providerRef ? ` · ${p.providerRef}` : ''}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {formatDateTime(p.createdAt)}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Fulfillments</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            {fulfillmentRows.length === 0 ? (
              <p className="text-sm text-muted-foreground">No fulfillments yet.</p>
            ) : (
              fulfillmentRows.map(f => (
                <div key={f.id} className="rounded-md border p-3">
                  <div className="flex items-center justify-between gap-2">
                    <div>
                      <div className="font-mono text-xs">{f.id}</div>
                      <div className="text-xs text-muted-foreground">
                        {f.carrier ?? '—'} · {f.trackingNumber ?? 'no tracking'}
                      </div>
                    </div>
                    <StatusBadge status={f.status} />
                  </div>
                  <div className="mt-2 text-xs text-muted-foreground">
                    {f.shippedAt ? `Shipped ${formatDateTime(f.shippedAt)}` : 'Not shipped'}
                    {f.deliveredAt ? ` · Delivered ${formatDateTime(f.deliveredAt)}` : ''}
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
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Refund history</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          {refundRows.length === 0 ? (
            <p className="text-sm text-muted-foreground">No refunds recorded.</p>
          ) : (
            refundRows.map(r => (
              <div key={r.id} className="rounded-md border p-3">
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <div className="font-medium">
                      {formatMoney(r.amountCents, currency)}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {r.providerRef ?? 'no provider ref'} · {formatDateTime(r.createdAt)}
                    </div>
                    {r.reason ? (
                      <div className="text-xs text-muted-foreground">
                        Reason: {r.reason}
                      </div>
                    ) : null}
                  </div>
                  <StatusBadge status={r.status} />
                </div>
              </div>
            ))
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Timeline</CardTitle>
        </CardHeader>
        <CardContent>
          {timeline.length === 0 ? (
            <p className="text-sm text-muted-foreground">No events yet.</p>
          ) : (
            <ol className="space-y-2">
              {timeline.map(ev => (
                <li
                  key={ev.id}
                  className="flex items-start justify-between gap-3 rounded-md border p-2 text-sm"
                >
                  <div>
                    <div className="font-medium">{ev.kind}</div>
                    <div className="text-xs text-muted-foreground">
                      {ev.actorType}
                      {ev.actorId ? ` · ${ev.actorId}` : ''}
                    </div>
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {formatDateTime(ev.createdAt)}
                  </div>
                </li>
              ))}
            </ol>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function Field({
  label,
  value,
}: {
  label: string;
  value: React.ReactNode;
}) {
  return (
    <div className="space-y-0.5">
      <div className="text-xs uppercase text-muted-foreground">{label}</div>
      <div>{value}</div>
    </div>
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
      <div className="text-xs uppercase text-muted-foreground">{title}</div>
      {address ? (
        <div className="text-sm">
          <div>{address.name}</div>
          <div>{address.line1}</div>
          {address.line2 ? <div>{address.line2}</div> : null}
          <div>
            {address.city}, {address.region} {address.postal}
          </div>
          <div>{address.country}</div>
          {address.phone ? (
            <div className="text-xs text-muted-foreground">{address.phone}</div>
          ) : null}
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">Not provided.</p>
      )}
    </div>
  );
}
