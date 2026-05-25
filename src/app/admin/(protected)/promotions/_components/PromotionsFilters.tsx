'use client';

import { useRouter } from 'next/navigation';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

const ANY = '__any__';

export function PromotionsFilters({ status }: { status: string }) {
  const router = useRouter();

  function apply(next: { status: string }) {
    const params = new URLSearchParams();
    if (next.status) params.set('status', next.status);
    const qs = params.toString();
    router.push(
      (qs ? `/admin/promotions?${qs}` : '/admin/promotions') as Parameters<typeof router.push>[0],
    );
  }

  return (
    <div className="flex flex-wrap items-end gap-3">
      <div className="w-44">
        <Select
          value={status || ANY}
          onValueChange={v => apply({ status: v === ANY ? '' : v })}
        >
          <SelectTrigger>
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ANY}>All statuses</SelectItem>
            <SelectItem value="draft">Draft</SelectItem>
            <SelectItem value="active">Active</SelectItem>
            <SelectItem value="paused">Paused</SelectItem>
            <SelectItem value="archived">Archived</SelectItem>
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}
