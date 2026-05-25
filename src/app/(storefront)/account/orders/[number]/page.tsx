import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { getOrderByNumber } from '@/modules/checkout/orders';
import { getOrderTimeline } from '@/modules/orders/events';
import type { Address } from '@/db/schema/carts';
import { formatMoney } from '../../../_lib/money';
import { getAccountContext } from '../../_lib';

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

  return (
    <div className="space-y-8">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="space-y-1">
          <p className="text-xs uppercase tracking-wider text-muted-foreground">
            Order
          </p>
          <h1 className="font-serif text-3xl font-semibold tracking-tight text-brand">
            {order.number}
          </h1>
          <p className="text-sm text-muted-foreground">
            Placed {formatPlacedAt(order.placedAt)}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <OrderStatusBadge status={order.status} />
          <Button asChild variant="outline" size="sm">
            <Link href="/account/orders">All orders</Link>
          </Button>
        </div>
      </header>

      <div className="grid gap-6 lg:grid-cols-[1fr_20rem]">
        <div className="space-y-6">
          <Card>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Item</TableHead>
                    <TableHead className="text-right">Qty</TableHead>
                    <TableHead className="text-right">Unit</TableHead>
                    <TableHead className="text-right">Total</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {order.items.map(item => (
                    <TableRow key={item.id}>
                      <TableCell>
                        <div className="space-y-0.5">
                          <p className="font-medium">{item.name}</p>
                          <p className="text-xs text-muted-foreground">
                            SKU {item.sku}
                          </p>
                        </div>
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {item.qty}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {formatMoney(item.unitPriceCents, config)}
                      </TableCell>
                      <TableCell className="text-right font-medium tabular-nums">
                        {formatMoney(item.lineTotalCents, config)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          <div className="grid gap-4 sm:grid-cols-2">
            <AddressCard title="Shipping address" address={order.shippingAddress} />
            <AddressCard title="Billing address" address={order.billingAddress} />
          </div>

          <Card>
            <CardContent className="space-y-4 p-6">
              <h2 className="font-medium">Status timeline</h2>
              {customerTimeline.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No status updates yet.
                </p>
              ) : (
                <ol className="space-y-3">
                  {customerTimeline.map(ev => (
                    <li key={ev.id} className="flex gap-3 text-sm">
                      <span
                        aria-hidden
                        className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-brand"
                      />
                      <div className="space-y-0.5">
                        <p className="capitalize">
                          {ev.kind.replace(/[._]/g, ' ')}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {formatTimelineAt(ev.createdAt)}
                        </p>
                      </div>
                    </li>
                  ))}
                </ol>
              )}
            </CardContent>
          </Card>
        </div>

        <Card className="h-fit">
          <CardContent className="space-y-4 p-6">
            <h2 className="font-medium">Summary</h2>
            <dl className="space-y-2 text-sm">
              <Row
                label="Subtotal"
                value={formatMoney(order.subtotalCents, config)}
              />
              {order.discountCents > 0 ? (
                <Row
                  label="Discount"
                  value={`−${formatMoney(order.discountCents, config)}`}
                />
              ) : null}
              <Row label="Tax" value={formatMoney(order.taxCents, config)} />
              <Row
                label="Shipping"
                value={formatMoney(order.shippingCents, config)}
              />
            </dl>
            <Separator />
            <div className="flex items-center justify-between text-base font-semibold">
              <span>Total</span>
              <span>{formatMoney(order.totalCents, config)}</span>
            </div>
            {order.couponCode ? (
              <p className="rounded-md bg-brand/5 px-3 py-2 text-xs text-muted-foreground">
                Coupon <span className="font-medium">{order.couponCode}</span>
              </p>
            ) : null}
            <dl className="space-y-2 pt-2 text-xs text-muted-foreground">
              <div className="flex justify-between">
                <dt>Payment</dt>
                <dd className="capitalize">{order.paymentStatus}</dd>
              </div>
              <div className="flex justify-between">
                <dt>Fulfillment</dt>
                <dd className="capitalize">
                  {order.fulfillmentStatus.replace(/_/g, ' ')}
                </dd>
              </div>
            </dl>
          </CardContent>
        </Card>
      </div>
    </div>
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
    <Card>
      <CardContent className="space-y-2 p-6">
        <h3 className="font-medium">{title}</h3>
        {address ? (
          <address className="text-sm not-italic leading-relaxed text-muted-foreground">
            <span className="block font-medium text-foreground">
              {address.name}
            </span>
            <span className="block">{address.line1}</span>
            {address.line2 ? <span className="block">{address.line2}</span> : null}
            <span className="block">
              {address.city}, {address.region} {address.postal}
            </span>
            <span className="block">{address.country}</span>
            {address.phone ? <span className="block">{address.phone}</span> : null}
          </address>
        ) : (
          <p className="text-sm text-muted-foreground">No address on file.</p>
        )}
      </CardContent>
    </Card>
  );
}

function OrderStatusBadge({ status }: { status: string }) {
  const variant: 'default' | 'secondary' | 'destructive' | 'outline' =
    status === 'cancelled'
      ? 'destructive'
      : status === 'refunded'
        ? 'outline'
        : status === 'pending_payment'
          ? 'secondary'
          : 'default';
  return (
    <Badge variant={variant} className="capitalize">
      {status.replace(/_/g, ' ')}
    </Badge>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="tabular-nums">{value}</dd>
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
