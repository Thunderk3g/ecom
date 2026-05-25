'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

const ANY = '__any__';

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
    <div className="flex flex-wrap items-end gap-3">
      <div className="w-40">
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
            <SelectItem value="archived">Archived</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div className="w-56">
        <Select
          value={categoryId || ANY}
          onValueChange={v => apply({ categoryId: v === ANY ? '' : v })}
        >
          <SelectTrigger>
            <SelectValue placeholder="Category" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ANY}>All categories</SelectItem>
            {categories.map(c => (
              <SelectItem key={c.id} value={c.id}>
                {c.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <form
        className="flex items-end gap-2"
        onSubmit={e => {
          e.preventDefault();
          apply({ brand: brandInput });
        }}
      >
        <Input
          placeholder="Brand"
          value={brandInput}
          onChange={e => setBrandInput(e.target.value)}
          className="w-40"
        />
        <Button type="submit" variant="outline">
          Filter
        </Button>
      </form>
    </div>
  );
}
