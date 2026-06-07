'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useCallback } from 'react';
import type { Facets } from '@/modules/catalog/facets';

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
    <aside className="filters-rail">
      <div className="between" style={{ marginBottom: 8 }}>
        <span className="cap" style={{ letterSpacing: '.14em' }}>
          Filters
        </span>
        {hasAnyFilter ? (
          <button
            type="button"
            className="meta link-u"
            onClick={() => router.push(pathname)}
          >
            Clear all
          </button>
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
    <details className="facet" open>
      <summary style={{ textTransform: 'capitalize' }}>
        {label} <span className="pm">+</span>
      </summary>
      <div className="facet-body">
        {options.map(opt => {
          const isActive = active === opt.value;
          return (
            <label key={opt.value} className="check">
              <input
                type="checkbox"
                checked={isActive}
                onChange={() => onToggle(opt.value)}
              />{' '}
              {opt.value} <span className="ct">{opt.count}</span>
            </label>
          );
        })}
      </div>
    </details>
  );
}
