import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getAdminContext } from '../../_lib/context';
import { getCustomer } from '@/modules/customers/customers';
import { listAddresses } from '@/modules/customers/addresses';
import { listOrders } from '@/modules/orders/lifecycle';
import { CustomerNotFoundError } from '@/modules/customers/errors';
import { formatDateTime, formatMoney } from '@/lib/format';
import { statpillClass, statusLabel } from '../../orders/_status';
import { AddressList } from './_components/AddressList';

export const dynamic = 'force-dynamic';

export default async function CustomerDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { storeId } = await getAdminContext();

  let customer;
  try {
    customer = await getCustomer(storeId, id);
  } catch (err) {
    if (err instanceof CustomerNotFoundError) notFound();
    throw err;
  }

  // Orders by this customer (filtered via the denormalized order email; the
  // module's customerEmail filter handles both registered and guest orders for
  // the same email — which is the desired admin view).
  const [addresses, ordersResult] = await Promise.all([
    listAddresses(storeId, customer.id),
    listOrders(storeId, { customerEmail: customer.email, limit: 50 }),
  ]);

  return (
    <>
      <div className="between" style={{ marginBottom: 20 }}>
        <div>
          <div className="row" style={{ gap: 10 }}>
            <h2 className="h-md" style={{ fontFamily: 'var(--serif)' }}>
              {customer.email}
            </h2>
            <span
              className={`statpill ${customer.userId ? 'sp-active' : 'sp-draft'}`}
            >
              {customer.userId ? 'Registered' : 'Guest'}
            </span>
          </div>
          <span className="t-sub">Customer · {customer.locale}</span>
        </div>
      </div>

      <div className="adm-cols">
        {/* Left: profile + order history */}
        <div className="stack" style={{ gap: 16 }}>
          <div className="panel">
            <div className="panel-head">
              <h3>Order history</h3>
            </div>
            {ordersResult.items.length === 0 ? (
              <div className="panel-pad">
                <p className="t-sub">No orders for this customer yet.</p>
              </div>
            ) : (
              <table className="dtable">
                <thead>
                  <tr>
                    <th>Number</th>
                    <th>Status</th>
                    <th>Payment</th>
                    <th className="num">Total</th>
                    <th>Placed</th>
                  </tr>
                </thead>
                <tbody>
                  {ordersResult.items.map(o => (
                    <tr key={o.id}>
                      <td className="t-strong">
                        <Link
                          href={
                            `/admin/orders/${o.id}` as Parameters<typeof Link>[0]['href']
                          }
                        >
                          {o.number}
                        </Link>
                      </td>
                      <td>
                        <span className={`statpill ${statpillClass(o.status)}`}>
                          {statusLabel(o.status)}
                        </span>
                      </td>
                      <td>
                        <span
                          className={`statpill ${statpillClass(o.paymentStatus)}`}
                        >
                          {statusLabel(o.paymentStatus)}
                        </span>
                      </td>
                      <td className="num t-strong">
                        {formatMoney(o.totalCents, o.currency)}
                      </td>
                      <td className="t-sub">{formatDateTime(o.placedAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          <div className="panel">
            <div className="panel-head">
              <h3>Address book</h3>
            </div>
            <div className="panel-pad">
              <AddressList
                customerId={customer.id}
                addresses={addresses.map(a => ({
                  id: a.id,
                  type: a.type,
                  name: a.name,
                  line1: a.line1,
                  line2: a.line2,
                  city: a.city,
                  region: a.region,
                  postal: a.postal,
                  country: a.country,
                  phone: a.phone,
                  isDefault: a.isDefault,
                }))}
              />
            </div>
          </div>
        </div>

        {/* Right: profile */}
        <aside className="stack" style={{ gap: 16 }}>
          <div className="panel">
            <div className="panel-head">
              <h3>Profile</h3>
            </div>
            <div className="panel-pad stack" style={{ gap: 0 }}>
              <ProfileField label="Email" value={customer.email} />
              <ProfileField label="Phone" value={customer.phone ?? '—'} />
              <ProfileField label="Locale" value={customer.locale} />
              <ProfileField label="Segment" value={customer.segment ?? '—'} />
              <ProfileField
                label="Marketing opt-in"
                value={customer.acceptsMarketing ? 'Yes' : 'No'}
              />
              <ProfileField
                label="Lifetime value"
                value={formatMoney(customer.lifetimeValueCents)}
              />
              <ProfileField
                label="Orders on file"
                value={String(ordersResult.items.length)}
              />
              <ProfileField
                label="Customer since"
                value={formatDateTime(customer.createdAt)}
              />
              <ProfileField
                label="Account"
                value={customer.userId ? 'Registered' : 'Guest'}
              />
            </div>
          </div>
        </aside>
      </div>
    </>
  );
}

function ProfileField({ label, value }: { label: string; value: string }) {
  return (
    <div
      className="between"
      style={{ padding: '9px 0', borderBottom: '1px solid var(--line-soft)' }}
    >
      <span className="t-sub">{label}</span>
      <span className="t-strong" style={{ fontSize: 13.5 }}>
        {value}
      </span>
    </div>
  );
}
