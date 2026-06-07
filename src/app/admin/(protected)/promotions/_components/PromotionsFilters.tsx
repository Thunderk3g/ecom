'use client';

import { useRouter } from 'next/navigation';

const OPTIONS: Array<{ value: string; label: string }> = [
  { value: '', label: 'All' },
  { value: 'draft', label: 'Draft' },
  { value: 'active', label: 'Active' },
  { value: 'paused', label: 'Paused' },
  { value: 'archived', label: 'Archived' },
];

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
    <div className="seg">
      {OPTIONS.map(o => (
        <button
          key={o.value || 'all'}
          type="button"
          className={status === o.value ? 'on' : undefined}
          onClick={() => apply({ status: o.value })}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
