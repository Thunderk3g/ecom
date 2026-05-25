import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { listCustomerOrders } from '@/modules/checkout/orders';
import { formatMoney } from '../../_lib/money';
import { getAccountContext } from '../_lib';

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
    <div className="space-y-6">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="font-serif text-3xl font-semibold tracking-tight text-brand">
            Orders
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Every order you&apos;ve placed with us, newest first.
          </p>
        </div>
        <Button asChild variant="outline" size="sm">
          <Link href="/account">Back to account</Link>
        </Button>
      </header>

      {items.length === 0 ? (
        <Card>
          <CardContent className="space-y-3 py-12 text-center">
            <p className="text-muted-foreground">No orders yet.</p>
            <Button asChild size="sm">
              <Link href="/search">Browse the shop</Link>
            </Button>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Order</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map(order => (
                  <TableRow key={order.id}>
                    <TableCell>
                      <Link
                        href={`/account/orders/${encodeURIComponent(order.number)}`}
                        className="font-medium hover:underline"
                      >
                        {order.number}
                      </Link>
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {formatPlacedAt(order.placedAt)}
                    </TableCell>
                    <TableCell>
                      <OrderStatusBadge status={order.status} />
                    </TableCell>
                    <TableCell className="text-right font-medium">
                      {formatMoney(order.totalCents, config)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {nextCursor ? (
        <div className="flex justify-end">
          <Button asChild variant="outline" size="sm">
            <Link href={`/account/orders?after=${encodeURIComponent(nextCursor)}`}>
              Next page
            </Link>
          </Button>
        </div>
      ) : null}
    </div>
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

function formatPlacedAt(value: Date): string {
  return new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium' }).format(value);
}
