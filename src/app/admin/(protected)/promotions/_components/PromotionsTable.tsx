'use client';

import { useRouter } from 'next/navigation';
import { useMemo } from 'react';
import type { ColumnDef } from '@tanstack/react-table';
import { DataTable } from '@/components/admin/DataTable';
import { formatMoney, formatDateTime } from '@/lib/format';

export type PromotionListRow = {
  id: string;
  code: string | null;
  name: string;
  type: 'percent' | 'amount' | 'free_shipping' | 'bxgy';
  status: 'draft' | 'active' | 'paused' | 'archived';
  percent: number | null;
  valueCents: number | null;
  bxgyBuy: number | null;
  bxgyGet: number | null;
  usedCount: number;
  usageLimit: number | null;
  startsAt: string | null;
  endsAt: string | null;
};

const STATUS_PILL: Record<string, string> = {
  active: 'sp-active',
  draft: 'sp-draft',
  paused: 'sp-low',
  archived: 'sp-draft',
};

const TYPE_LABEL: Record<PromotionListRow['type'], string> = {
  percent: 'Percent',
  amount: 'Amount',
  free_shipping: 'Free shipping',
  bxgy: 'Buy X / Get Y',
};

function formatValue(row: PromotionListRow): string {
  switch (row.type) {
    case 'percent':
      return row.percent !== null ? `${row.percent}%` : '—';
    case 'amount':
      return row.valueCents !== null ? formatMoney(row.valueCents) : '—';
    case 'free_shipping':
      return 'Free shipping';
    case 'bxgy':
      if (row.bxgyBuy && row.bxgyGet) {
        return `Buy ${row.bxgyBuy}, get ${row.bxgyGet}`;
      }
      return '—';
    default:
      return '—';
  }
}

function formatWindow(row: PromotionListRow): string {
  const starts = row.startsAt ? formatDateTime(row.startsAt) : '—';
  const ends = row.endsAt ? formatDateTime(row.endsAt) : '—';
  if (!row.startsAt && !row.endsAt) return 'Always';
  return `${starts} → ${ends}`;
}

function formatUsage(row: PromotionListRow): string {
  if (row.usageLimit === null) return `${row.usedCount} / ∞`;
  return `${row.usedCount} / ${row.usageLimit}`;
}

export function PromotionsTable({ rows }: { rows: PromotionListRow[] }) {
  const router = useRouter();

  const columns = useMemo<ColumnDef<PromotionListRow>[]>(
    () => [
      {
        accessorKey: 'code',
        header: 'Code',
        cell: ({ row }) => (
          <div>
            <div className="t-strong" style={{ fontFamily: 'ui-monospace,monospace' }}>
              {row.original.code ?? <span className="t-sub">auto</span>}
            </div>
            <div className="t-sub">{row.original.name}</div>
          </div>
        ),
      },
      {
        accessorKey: 'type',
        header: 'Type',
        cell: ({ row }) => TYPE_LABEL[row.original.type],
      },
      {
        id: 'label',
        header: 'Label',
        cell: ({ row }) => row.original.name,
      },
      {
        id: 'value',
        header: 'Value',
        cell: ({ row }) => formatValue(row.original),
      },
      {
        id: 'usage',
        header: 'Usage',
        cell: ({ row }) => formatUsage(row.original),
      },
      {
        id: 'window',
        header: 'Active window',
        cell: ({ row }) => (
          <span className="text-xs">{formatWindow(row.original)}</span>
        ),
      },
      {
        accessorKey: 'status',
        header: 'Status',
        cell: ({ row }) => (
          <span className={`statpill ${STATUS_PILL[row.original.status] ?? 'sp-draft'}`}>
            {row.original.status}
          </span>
        ),
      },
    ],
    [],
  );

  return (
    <DataTable
      columns={columns}
      data={rows}
      emptyMessage="No promotions match these filters."
      onRowClick={r =>
        router.push(`/admin/promotions/${r.id}` as Parameters<typeof router.push>[0])
      }
    />
  );
}
