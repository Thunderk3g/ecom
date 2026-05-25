import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { Badge } from '@/components/ui/badge';
import { listCustomerOrders } from '@/modules/checkout/orders';
import { formatMoney } from '../_lib/money';
import { getAccountContext } from './_lib';
import { logoutAction } from './actions';

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
    <div className="space-y-10">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-serif text-3xl font-semibold tracking-tight text-brand">
            Hello, {greetingName}
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Manage your orders, addresses, and account details.
          </p>
        </div>
        <form action={logoutAction}>
          <Button type="submit" variant="outline" size="sm">
            Sign out
          </Button>
        </form>
      </header>

      <div className="grid gap-6 lg:grid-cols-[20rem_1fr]">
        <Card className="h-fit">
          <CardContent className="space-y-4 p-6">
            <h2 className="font-medium">Account</h2>
            <dl className="space-y-2 text-sm">
              <div className="flex justify-between gap-4">
                <dt className="text-muted-foreground">Email</dt>
                <dd className="truncate text-right">{customer.email}</dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-muted-foreground">Member since</dt>
                <dd>{memberSince}</dd>
              </div>
              {customer.phone ? (
                <div className="flex justify-between gap-4">
                  <dt className="text-muted-foreground">Phone</dt>
                  <dd>{customer.phone}</dd>
                </div>
              ) : null}
            </dl>
            <Separator />
            <div className="grid gap-2">
              <Button asChild variant="outline" size="sm" className="justify-start">
                <Link href="/account/orders">Order history</Link>
              </Button>
              <Button asChild variant="outline" size="sm" className="justify-start">
                <Link href="/account/addresses">Saved addresses</Link>
              </Button>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="space-y-4 p-6">
            <div className="flex items-center justify-between">
              <h2 className="font-medium">Recent orders</h2>
              <Link
                href="/account/orders"
                className="text-sm text-muted-foreground hover:underline"
              >
                View all
              </Link>
            </div>

            {recentOrders.length === 0 ? (
              <div className="space-y-3 py-8 text-center">
                <p className="text-sm text-muted-foreground">
                  You haven&apos;t placed any orders yet.
                </p>
                <Button asChild size="sm">
                  <Link href="/search">Start shopping</Link>
                </Button>
              </div>
            ) : (
              <ul className="divide-y">
                {recentOrders.map(order => (
                  <li
                    key={order.id}
                    className="flex flex-wrap items-center justify-between gap-3 py-4"
                  >
                    <div className="space-y-1">
                      <Link
                        href={`/account/orders/${encodeURIComponent(order.number)}`}
                        className="font-medium hover:underline"
                      >
                        {order.number}
                      </Link>
                      <p className="text-xs text-muted-foreground">
                        {formatPlacedAt(order.placedAt)} · {order.items.length} item
                        {order.items.length === 1 ? '' : 's'}
                      </p>
                    </div>
                    <div className="flex items-center gap-3">
                      <OrderStatusBadge status={order.status} />
                      <span className="text-sm font-semibold">
                        {formatMoney(order.totalCents, config)}
                      </span>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

/**
 * Map an order status to a Badge variant. Mirrors
 * `src/app/admin/(protected)/orders/_status.ts` but scoped to this surface so
 * we don't reach across the admin/storefront boundary.
 */
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
