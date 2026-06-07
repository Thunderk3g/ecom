'use client';

import { useRouter } from 'next/navigation';
import { formatDateTime, formatMoney } from '@/lib/format';

export type CustomerListRow = {
  id: string;
  email: string;
  name: string;
  locale: string;
  orderCount: number;
  lifetimeValueCents: number;
  createdAt: string;
};

/** Two-letter initials from the customer's display name (or email). */
function initials(name: string, email: string): string {
  const source = (name || email).trim();
  const parts = source.split(/[\s.@_-]+/).filter(Boolean);
  if (parts.length >= 2) {
    return (parts[0]![0]! + parts[1]![0]!).toUpperCase();
  }
  return source.slice(0, 2).toUpperCase();
}

export function CustomersTable({ rows }: { rows: CustomerListRow[] }) {
  const router = useRouter();

  if (rows.length === 0) {
    return (
      <div className="panel-pad t-sub" style={{ textAlign: 'center' }}>
        No customers match this search.
      </div>
    );
  }

  return (
    <table className="dtable">
      <thead>
        <tr>
          <th>Customer</th>
          <th>Locale</th>
          <th className="num">Orders</th>
          <th className="num">Lifetime value</th>
          <th>Signed up</th>
        </tr>
      </thead>
      <tbody>
        {rows.map(r => (
          <tr
            key={r.id}
            style={{ cursor: 'pointer' }}
            onClick={() =>
              router.push(
                `/admin/customers/${r.id}` as Parameters<typeof router.push>[0],
              )
            }
          >
            <td>
              <div className="cellrow">
                <span className="av">{initials(r.name, r.email)}</span>
                <div>
                  <div className="t-strong">{r.email}</div>
                  <div className="t-sub">{r.name}</div>
                </div>
              </div>
            </td>
            <td className="t-sub">{r.locale}</td>
            <td className="num">{r.orderCount}</td>
            <td className="num t-strong">{formatMoney(r.lifetimeValueCents)}</td>
            <td className="t-sub">{formatDateTime(r.createdAt)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
