'use client';

import { useRouter } from 'next/navigation';
import { formatDateTime, formatMoney } from '@/lib/format';
import { StatusBadge } from './StatusBadge';
import { statpillClass, statusLabel } from '../_status';

export type OrderListRow = {
  id: string;
  number: string;
  email: string;
  status: string;
  paymentStatus: string;
  fulfillmentStatus: string;
  totalCents: number;
  currency: string;
  placedAt: string;
};

export function OrdersTable({ rows }: { rows: OrderListRow[] }) {
  const router = useRouter();

  if (rows.length === 0) {
    return (
      <div className="panel-pad t-sub" style={{ textAlign: 'center' }}>
        No orders match these filters.
      </div>
    );
  }

  return (
    <table className="dtable">
      <thead>
        <tr>
          <th>Order</th>
          <th>Customer</th>
          <th>Status</th>
          <th>Payment</th>
          <th>Fulfilment</th>
          <th className="num">Total</th>
          <th>Placed</th>
        </tr>
      </thead>
      <tbody>
        {rows.map(r => (
          <tr
            key={r.id}
            style={{ cursor: 'pointer' }}
            onClick={() =>
              router.push(
                `/admin/orders/${r.id}` as Parameters<typeof router.push>[0],
              )
            }
          >
            <td className="t-strong">{r.number}</td>
            <td className="t-sub">{r.email}</td>
            <td>
              <StatusBadge status={r.status} />
            </td>
            <td>
              <span className={`statpill ${statpillClass(r.paymentStatus)}`}>
                {statusLabel(r.paymentStatus)}
              </span>
            </td>
            <td>
              <span
                className={`statpill ${statpillClass(r.fulfillmentStatus)}`}
              >
                {statusLabel(r.fulfillmentStatus)}
              </span>
            </td>
            <td className="num t-strong">
              {formatMoney(r.totalCents, r.currency)}
            </td>
            <td className="t-sub">{formatDateTime(r.placedAt)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
