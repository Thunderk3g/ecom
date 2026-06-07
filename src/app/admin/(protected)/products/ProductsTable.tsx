'use client';

import { useRouter } from 'next/navigation';
import { formatDateTime } from '@/lib/format';

export type ProductListRow = {
  id: string;
  name: string;
  slug: string;
  status: string;
  brand: string | null;
  type: string;
  categoryName: string | null;
  updatedAt: string;
};

const STATUS_PILL: Record<string, string> = {
  active: 'sp-active',
  draft: 'sp-draft',
  archived: 'sp-out',
};

export function ProductsTable({ rows }: { rows: ProductListRow[] }) {
  const router = useRouter();

  if (rows.length === 0) {
    return (
      <div className="panel-pad t-sub">No products match these filters.</div>
    );
  }

  return (
    <table className="dtable">
      <thead>
        <tr>
          <th>Product</th>
          <th>Status</th>
          <th>Brand</th>
          <th>Category</th>
          <th>Type</th>
          <th>Updated</th>
        </tr>
      </thead>
      <tbody>
        {rows.map(r => (
          <tr
            key={r.id}
            style={{ cursor: 'pointer' }}
            onClick={() =>
              router.push(
                `/admin/products/${r.id}` as Parameters<typeof router.push>[0],
              )
            }
          >
            <td>
              <div className="cellrow">
                <div className="ph" data-label={r.name.slice(0, 3).toUpperCase()} />
                <div>
                  <div className="t-strong">{r.name}</div>
                  <div className="t-sub">{r.slug}</div>
                </div>
              </div>
            </td>
            <td>
              <span className={`statpill ${STATUS_PILL[r.status] ?? 'sp-draft'}`}>
                {r.status}
              </span>
            </td>
            <td>{r.brand ?? '—'}</td>
            <td>{r.categoryName ?? '—'}</td>
            <td>{r.type}</td>
            <td className="t-sub">{formatDateTime(r.updatedAt)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
