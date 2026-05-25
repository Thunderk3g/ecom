'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useCallback } from 'react';
import type { Facets } from '@/modules/catalog/facets';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';

/**
 * Faceted filter sidebar (client). Reads the computed facets passed from the
 * server and reflects the active selection into the URL query string so the
 * server component re-renders the filtered listing. Brand + attribute axes are
 * single-select toggles (clicking an active value clears it).
 */
export function FilterSidebar({ facets }: { facets: Facets }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  const setParam = useCallback(
    (key: string, value: string | null) => {
      const next = new URLSearchParams(params.toString());
      if (value === null || next.get(key) === value) {
        next.delete(key);
      } else {
        next.set(key, value);
      }
      // Reset pagination cursor whenever a filter changes.
      next.delete('after');
      router.push(`${pathname}?${next.toString()}`);
    },
    [params, pathname, router],
  );

  const hasAnyFilter =
    params.get('brand') !== null ||
    [...params.keys()].some(k => k.startsWith('attr_'));

  return (
    <aside className="w-full space-y-6 md:w-56 md:shrink-0">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Filters
        </h2>
        {hasAnyFilter ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-auto p-0 text-xs"
            onClick={() => router.push(pathname)}
          >
            Clear
          </Button>
        ) : null}
      </div>

      {facets.brands.length > 0 ? (
        <FacetGroup
          label="Brand"
          options={facets.brands.map(b => ({ value: b.brand, count: b.count }))}
          active={params.get('brand')}
          onToggle={value => setParam('brand', value)}
        />
      ) : null}

      {Object.entries(facets.attributes).map(([key, values]) =>
        values.length > 0 ? (
          <FacetGroup
            key={key}
            label={key}
            options={values.map(v => ({ value: v.value, count: v.count }))}
            active={params.get(`attr_${key}`)}
            onToggle={value => setParam(`attr_${key}`, value)}
          />
        ) : null,
      )}
    </aside>
  );
}

function FacetGroup({
  label,
  options,
  active,
  onToggle,
}: {
  label: string;
  options: { value: string; count: number }[];
  active: string | null;
  onToggle: (value: string) => void;
}) {
  return (
    <div className="space-y-2">
      <Label className="capitalize">{label}</Label>
      <ul className="space-y-1">
        {options.map(opt => {
          const isActive = active === opt.value;
          return (
            <li key={opt.value}>
              <button
                type="button"
                onClick={() => onToggle(opt.value)}
                className={`flex w-full items-center justify-between rounded-md px-2 py-1 text-left text-sm transition-colors ${
                  isActive ? 'bg-brand/10 font-medium text-brand' : 'hover:bg-accent'
                }`}
              >
                <span className="truncate">{opt.value}</span>
                <span className="ml-2 text-xs text-muted-foreground">{opt.count}</span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
