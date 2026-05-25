import Link from 'next/link';
import { and, desc, eq, gte, lte, sql } from 'drizzle-orm';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { withTenant } from '@/modules/tenant/with-tenant';
import { orders } from '@/db/schema/orders';
import { customers } from '@/db/schema/customers';
import { stockLevels, stockThresholds } from '@/db/schema/inventory';
import { getAdminContext } from './_lib/context';
import { PageHeader } from './_lib/ui';
import { formatMoney, formatDateTime } from '@/lib/format';
import { ORDER_STATUS_VARIANT } from './orders/_status';

export const dynamic = 'force-dynamic';

type DashboardData = {
  ordersToday: number;
  revenueToday: number;
  lowStockCount: number;
  recentOrders: Array<{
    id: string;
    number: string;
    email: string;
    status: string;
    totalCents: number;
    currency: string;
    placedAt: Date;
  }>;
  recentCustomers: Array<{ id: string; email: string; createdAt: Date }>;
};

async function loadDashboard(storeId: string): Promise<DashboardData> {
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);
  const endOfDay = new Date(startOfDay);
  endOfDay.setDate(endOfDay.getDate() + 1);

  return withTenant(storeId, async tx => {
    const [todayAgg] = await tx
      .select({
        count: sql<number>`count(*)::int`,
        revenue: sql<number>`COALESCE(SUM(${orders.totalCents}), 0)::int`,
      })
      .from(orders)
      .where(and(gte(orders.placedAt, startOfDay), lte(orders.placedAt, endOfDay)));

    const [lowAgg] = await tx
      .select({ count: sql<number>`count(*)::int` })
      .from(stockLevels)
      .innerJoin(
        stockThresholds,
        and(
          eq(stockThresholds.variantId, stockLevels.variantId),
          eq(stockThresholds.locationId, stockLevels.locationId),
        ),
      )
      .where(
        sql`(${stockLevels.onHand} - ${stockLevels.reserved}) <= ${stockThresholds.reorderPoint}`,
      );

    const recentOrders = await tx
      .select({
        id: orders.id,
        number: orders.number,
        email: orders.email,
        status: orders.status,
        totalCents: orders.totalCents,
        currency: orders.currency,
        placedAt: orders.placedAt,
      })
      .from(orders)
      .orderBy(desc(orders.placedAt))
      .limit(8);

    const recentCustomers = await tx
      .select({
        id: customers.id,
        email: customers.email,
        createdAt: customers.createdAt,
      })
      .from(customers)
      .orderBy(desc(customers.createdAt))
      .limit(8);

    return {
      ordersToday: todayAgg?.count ?? 0,
      revenueToday: todayAgg?.revenue ?? 0,
      lowStockCount: lowAgg?.count ?? 0,
      recentOrders,
      recentCustomers,
    };
  });
}

export default async function AdminDashboardPage() {
  const { storeId } = await getAdminContext();
  const data = await loadDashboard(storeId);

  return (
    <div className="space-y-6">
      <PageHeader title="Dashboard" description="At-a-glance store activity." />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Orders today</CardDescription>
            <CardTitle className="text-3xl">{data.ordersToday}</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-xs text-muted-foreground">
              Revenue {formatMoney(data.revenueToday)}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Low-stock cells</CardDescription>
            <CardTitle className="text-3xl">{data.lowStockCount}</CardTitle>
          </CardHeader>
          <CardContent>
            <Link
              href={'/admin/inventory?lowOnly=true' as Parameters<typeof Link>[0]['href']}
              className="text-xs text-primary hover:underline"
            >
              Review inventory
            </Link>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Recent customers</CardDescription>
            <CardTitle className="text-3xl">{data.recentCustomers.length}</CardTitle>
          </CardHeader>
          <CardContent>
            <Link
              href={'/admin/customers' as Parameters<typeof Link>[0]['href']}
              className="text-xs text-primary hover:underline"
            >
              View customers
            </Link>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Recent orders</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {data.recentOrders.length === 0 ? (
              <p className="text-sm text-muted-foreground">No orders yet.</p>
            ) : (
              data.recentOrders.map(o => (
                <Link
                  key={o.id}
                  href={`/admin/orders/${o.id}` as Parameters<typeof Link>[0]['href']}
                  className="flex items-center justify-between rounded-md px-2 py-1.5 text-sm hover:bg-accent"
                >
                  <span className="flex items-center gap-2">
                    <span className="font-medium">{o.number}</span>
                    <Badge variant={ORDER_STATUS_VARIANT[o.status] ?? 'secondary'}>
                      {o.status}
                    </Badge>
                  </span>
                  <span className="text-muted-foreground">
                    {formatMoney(o.totalCents, o.currency)}
                  </span>
                </Link>
              ))
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">New customers</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {data.recentCustomers.length === 0 ? (
              <p className="text-sm text-muted-foreground">No customers yet.</p>
            ) : (
              data.recentCustomers.map(c => (
                <Link
                  key={c.id}
                  href={`/admin/customers/${c.id}` as Parameters<typeof Link>[0]['href']}
                  className="flex items-center justify-between rounded-md px-2 py-1.5 text-sm hover:bg-accent"
                >
                  <span className="truncate font-medium">{c.email}</span>
                  <span className="text-xs text-muted-foreground">
                    {formatDateTime(c.createdAt)}
                  </span>
                </Link>
              ))
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
