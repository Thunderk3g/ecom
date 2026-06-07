'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

const STATUS_TABS: Array<{ value: string; label: string }> = [
  { value: '', label: 'All' },
  { value: 'active', label: 'Active' },
  { value: 'draft', label: 'Draft' },
  { value: 'archived', label: 'Archived' },
];

export function ProductsFilters({
  status,
  categoryId,
  brand,
  categories,
}: {
  status: string;
  categoryId: string;
  brand: string;
  categories: Array<{ id: string; label: string }>;
}) {
  const router = useRouter();
  const [brandInput, setBrandInput] = useState(brand);

  function apply(next: Partial<{ status: string; categoryId: string; brand: string }>) {
    const params = new URLSearchParams();
    const merged = { status, categoryId, brand, ...next };
    if (merged.status) params.set('status', merged.status);
    if (merged.categoryId) params.set('categoryId', merged.categoryId);
    if (merged.brand) params.set('brand', merged.brand);
    const qs = params.toString();
    router.push((qs ? `/admin/products?${qs}` : '/admin/products') as Parameters<typeof router.push>[0]);
  }

  return (
    <div className="tbar">
      <div className="seg">
        {STATUS_TABS.map(t => (
          <button
            key={t.value || 'all'}
            type="button"
            className={status === t.value ? 'on' : undefined}
            onClick={() => apply({ status: t.value })}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div className="grow" />
      <form
        className="search"
        style={{ maxWidth: 220, padding: '8px 14px' }}
        onSubmit={e => {
          e.preventDefault();
          apply({ brand: brandInput });
        }}
      >
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.6">
          <circle cx="11" cy="11" r="7" />
          <path d="m20 20-3.2-3.2" />
        </svg>
        <input
          placeholder="Brand…"
          aria-label="Brand"
          value={brandInput}
          onChange={e => setBrandInput(e.target.value)}
        />
      </form>
      <select
        className="mini-select"
        aria-label="Category"
        value={categoryId}
        onChange={e => apply({ categoryId: e.target.value })}
      >
        <option value="">All categories</option>
        {categories.map(c => (
          <option key={c.id} value={c.id}>
            {c.label}
          </option>
        ))}
      </select>
    </div>
  );
}
