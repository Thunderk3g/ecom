'use client';

import { useRouter } from 'next/navigation';
import { useMemo } from 'react';
import type { ColumnDef } from '@tanstack/react-table';
import { Badge } from '@/components/ui/badge';
import { DataTable } from '@/components/admin/DataTable';
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

const STATUS_VARIANT: Record<string, 'default' | 'secondary' | 'outline'> = {
  active: 'default',
  draft: 'secondary',
  archived: 'outline',
};

export function ProductsTable({ rows }: { rows: ProductListRow[] }) {
  const router = useRouter();

  const columns = useMemo<ColumnDef<ProductListRow>[]>(
    () => [
      {
        accessorKey: 'name',
        header: 'Name',
        cell: ({ row }) => (
          <div>
            <div className="font-medium">{row.original.name}</div>
            <div className="text-xs text-muted-foreground">{row.original.slug}</div>
          </div>
        ),
      },
      {
        accessorKey: 'status',
        header: 'Status',
        cell: ({ row }) => (
          <Badge variant={STATUS_VARIANT[row.original.status] ?? 'secondary'}>
            {row.original.status}
          </Badge>
        ),
      },
      {
        accessorKey: 'categoryName',
        header: 'Category',
        cell: ({ row }) => row.original.categoryName ?? '—',
      },
      {
        accessorKey: 'brand',
        header: 'Brand',
        cell: ({ row }) => row.original.brand ?? '—',
      },
      { accessorKey: 'type', header: 'Type' },
      {
        accessorKey: 'updatedAt',
        header: 'Updated',
        cell: ({ row }) => formatDateTime(row.original.updatedAt),
      },
    ],
    [],
  );

  return (
    <DataTable
      columns={columns}
      data={rows}
      emptyMessage="No products match these filters."
      onRowClick={r =>
        router.push(`/admin/products/${r.id}` as Parameters<typeof router.push>[0])
      }
    />
  );
}
