'use client';

import { useRouter } from 'next/navigation';
import { useMemo } from 'react';
import type { ColumnDef } from '@tanstack/react-table';
import { DataTable } from '@/components/admin/DataTable';
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

export function CustomersTable({ rows }: { rows: CustomerListRow[] }) {
  const router = useRouter();

  const columns = useMemo<ColumnDef<CustomerListRow>[]>(
    () => [
      {
        accessorKey: 'email',
        header: 'Email',
        cell: ({ row }) => (
          <div>
            <div className="font-medium">{row.original.email}</div>
            <div className="text-xs text-muted-foreground">{row.original.name}</div>
          </div>
        ),
      },
      {
        accessorKey: 'locale',
        header: 'Locale',
        cell: ({ row }) => row.original.locale,
      },
      {
        accessorKey: 'orderCount',
        header: 'Orders',
        cell: ({ row }) => row.original.orderCount,
      },
      {
        accessorKey: 'lifetimeValueCents',
        header: 'Lifetime value',
        cell: ({ row }) => formatMoney(row.original.lifetimeValueCents),
      },
      {
        accessorKey: 'createdAt',
        header: 'Created',
        cell: ({ row }) => formatDateTime(row.original.createdAt),
      },
    ],
    [],
  );

  return (
    <DataTable
      columns={columns}
      data={rows}
      emptyMessage="No customers match this search."
      onRowClick={r =>
        router.push(`/admin/customers/${r.id}` as Parameters<typeof router.push>[0])
      }
    />
  );
}
