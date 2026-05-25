'use client';

import { useRouter } from 'next/navigation';
import { useMemo } from 'react';
import type { ColumnDef } from '@tanstack/react-table';
import { DataTable } from '@/components/admin/DataTable';
import { formatDateTime, formatMoney } from '@/lib/format';
import { StatusBadge } from './StatusBadge';

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

  const columns = useMemo<ColumnDef<OrderListRow>[]>(
    () => [
      {
        accessorKey: 'number',
        header: 'Order',
        cell: ({ row }) => (
          <div>
            <div className="font-medium">{row.original.number}</div>
            <div className="text-xs text-muted-foreground">{row.original.email}</div>
          </div>
        ),
      },
      {
        accessorKey: 'status',
        header: 'Status',
        cell: ({ row }) => <StatusBadge status={row.original.status} />,
      },
      {
        accessorKey: 'paymentStatus',
        header: 'Payment',
        cell: ({ row }) => row.original.paymentStatus,
      },
      {
        accessorKey: 'fulfillmentStatus',
        header: 'Fulfillment',
        cell: ({ row }) => row.original.fulfillmentStatus,
      },
      {
        accessorKey: 'totalCents',
        header: 'Total',
        cell: ({ row }) =>
          formatMoney(row.original.totalCents, row.original.currency),
      },
      {
        accessorKey: 'placedAt',
        header: 'Placed',
        cell: ({ row }) => formatDateTime(row.original.placedAt),
      },
    ],
    [],
  );

  return (
    <DataTable
      columns={columns}
      data={rows}
      emptyMessage="No orders match these filters."
      onRowClick={r =>
        router.push(`/admin/orders/${r.id}` as Parameters<typeof router.push>[0])
      }
    />
  );
}
