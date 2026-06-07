import Link from 'next/link';
import { and, desc, eq, gte, lte, sql } from 'drizzle-orm';
import { withTenant } from '@/modules/tenant/with-tenant';
import { orders } from '@/db/schema/orders';
import { customers } from '@/db/schema/customers';
import { stockLevels, stockThresholds } from '@/db/schema/inventory';
import { getAdminContext } from './_lib/context';
import { formatMoney, formatDateTime } from '@/lib/format';
import { statpillClass, statusLabel } from './orders/_status';

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
    <>
      <div className="between" style={{ marginBottom: 22 }}>
        <div>
          <h2 className="h-md" style={{ fontFamily: 'var(--serif)' }}>
            Dashboard
          </h2>
          <p className="t-sub" style={{ marginTop: 4 }}>
            At-a-glance store activity.
          </p>
        </div>
        <div className="row" style={{ gap: 10 }}>
          <Link
            href={'/admin/products/new' as Parameters<typeof Link>[0]['href']}
            className="btn btn-clay btn-sm"
          >
            + New product
          </Link>
        </div>
      </div>

      <div className="kpi-grid">
        <div className="kpi">
          <div className="lbl">Orders today</div>
          <div className="v">{data.ordersToday}</div>
          <span className="delta">Placed since midnight</span>
        </div>
        <div className="kpi">
          <div className="lbl">Revenue today</div>
          <div className="v">{formatMoney(data.revenueToday)}</div>
          <span className="delta">Gross order value</span>
        </div>
        <div className="kpi">
          <div className="lbl">Low stock</div>
          <div className="v" style={{ color: 'oklch(0.5 0.1 78)' }}>
            {data.lowStockCount}
          </div>
          <div className="row" style={{ gap: 6, marginTop: 12 }}>
            {data.lowStockCount > 0 ? (
              <span className="statpill sp-low">Needs action</span>
            ) : (
              <span className="statpill sp-active">All stocked</span>
            )}
          </div>
        </div>
        <div className="kpi">
          <div className="lbl">New customers</div>
          <div className="v">{data.recentCustomers.length}</div>
          <span className="delta">Most recent signups</span>
        </div>
      </div>

      <div className="adm-cols">
        <div className="panel">
          <div className="panel-head">
            <h3>Recent orders</h3>
            <Link
              href={'/admin/orders' as Parameters<typeof Link>[0]['href']}
              className="ucap link-u muted"
            >
              View all
            </Link>
          </div>
          {data.recentOrders.length === 0 ? (
            <div className="panel-pad t-sub">No orders yet.</div>
          ) : (
            <table className="dtable">
              <thead>
                <tr>
                  <th>Order</th>
                  <th>Customer</th>
                  <th>Status</th>
                  <th className="num">Total</th>
                </tr>
              </thead>
              <tbody>
                {data.recentOrders.map(o => (
                  <tr key={o.id}>
                    <td>
                      <Link
                        href={`/admin/orders/${o.id}` as Parameters<typeof Link>[0]['href']}
                        className="t-strong"
                      >
                        {o.number}
                      </Link>
                    </td>
                    <td className="t-sub">{o.email}</td>
                    <td>
                      <span className={`statpill ${statpillClass(o.status)}`}>
                        {statusLabel(o.status)}
                      </span>
                    </td>
                    <td className="num t-strong">
                      {formatMoney(o.totalCents, o.currency)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div className="panel">
          <div className="panel-head">
            <h3>New customers</h3>
            <Link
              href={'/admin/customers' as Parameters<typeof Link>[0]['href']}
              className="ucap link-u muted"
            >
              All
            </Link>
          </div>
          <div
            className="panel-pad stack"
            style={{ gap: 14, paddingTop: 8 }}
          >
            {data.recentCustomers.length === 0 ? (
              <p className="t-sub">No customers yet.</p>
            ) : (
              data.recentCustomers.map(c => (
                <Link
                  key={c.id}
                  href={`/admin/customers/${c.id}` as Parameters<typeof Link>[0]['href']}
                  className="cellrow"
                >
                  <span className="av">
                    {c.email.slice(0, 2).toUpperCase()}
                  </span>
                  <div className="grow">
                    <div className="t-strong" style={{ fontSize: '13.5px' }}>
                      {c.email}
                    </div>
                    <div className="t-sub">{formatDateTime(c.createdAt)}</div>
                  </div>
                </Link>
              ))
            )}
          </div>
        </div>
      </div>
    </>
  );
}
