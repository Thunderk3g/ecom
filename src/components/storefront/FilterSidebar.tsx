'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useId, useState } from 'react';
import type { Facets } from '@/modules/catalog/facets';

/**
 * Faceted filter sidebar (client). Reads the computed facets passed from the
 * server and reflects the active selection into the URL query string so the
 * server component re-renders the filtered listing. Brand + attribute axes are
 * single-select toggles (clicking an active value clears it); the price band
 * writes `pmin`/`pmax` (whole rupees), applied page-locally by the server.
 *
 * Facet groups collapse with an animated expand; on narrow viewports the whole
 * rail collapses behind a "Filters" disclosure (styles in listing.css).
 */
export function FilterSidebar({ facets }: { facets: Facets }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [mobileOpen, setMobileOpen] = useState(false);
  const bodyId = useId();

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
      const qs = next.toString();
      router.push(qs ? `${pathname}?${qs}` : pathname);
    },
    [params, pathname, router],
  );

  const applyPrice = useCallback(
    (min: string, max: string) => {
      const next = new URLSearchParams(params.toString());
      const clean = (raw: string): string | null => {
        const n = Number(raw);
        return raw.trim() !== '' && Number.isFinite(n) && n >= 0 ? String(Math.floor(n)) : null;
      };
      const pmin = clean(min);
      const pmax = clean(max);
      if (pmin) next.set('pmin', pmin);
      else next.delete('pmin');
      if (pmax) next.set('pmax', pmax);
      else next.delete('pmax');
      next.delete('after');
      const qs = next.toString();
      router.push(qs ? `${pathname}?${qs}` : pathname);
    },
    [params, pathname, router],
  );

  const isFilterKey = (k: string) =>
    k === 'brand' || k === 'pmin' || k === 'pmax' || k.startsWith('attr_');
  const activeCount = [...params.keys()].filter(isFilterKey).length;

  const clearAll = useCallback(() => {
    // Drop only filter params — keep sort/query/anything else intact.
    const next = new URLSearchParams(params.toString());
    for (const key of [...next.keys()]) {
      if (isFilterKey(key) || key === 'after') next.delete(key);
    }
    const qs = next.toString();
    router.push(qs ? `${pathname}?${qs}` : pathname);
  }, [params, pathname, router]);

  return (
    <aside className="filters-rail lst-filters">
      <button
        type="button"
        className="lst-filters-toggle"
        aria-expanded={mobileOpen}
        aria-controls={bodyId}
        onClick={() => setMobileOpen(o => !o)}
      >
        <span>
          Filters
          {activeCount > 0 ? <span className="lst-fcount">{activeCount}</span> : null}
        </span>
        <span className="pm" aria-hidden="true">
          +
        </span>
      </button>

      <div id={bodyId} className={`lst-filters-body${mobileOpen ? ' open' : ''}`}>
        <div className="between lst-filters-head">
          <span className="cap" style={{ letterSpacing: '.14em' }}>
            Filters
          </span>
          {activeCount > 0 ? (
            <button type="button" className="meta link-u lst-clear-btn" onClick={clearAll}>
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

        <PriceGroup
          initialMin={params.get('pmin') ?? ''}
          initialMax={params.get('pmax') ?? ''}
          onApply={applyPrice}
        />
      </div>
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
  const [open, setOpen] = useState(true);
  const panelId = useId();

  return (
    <div className={`facet lst-facet${open ? ' open' : ''}`}>
      <button
        type="button"
        className="lst-facet-head"
        style={{ textTransform: 'capitalize' }}
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen(o => !o)}
      >
        {label}
        {active ? <span className="lst-facet-dot" aria-hidden="true" /> : null}
        <span className="pm" aria-hidden="true">
          +
        </span>
      </button>
      <div id={panelId} className="lst-facet-panel">
        <div className="lst-facet-inner">
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
        </div>
      </div>
    </div>
  );
}

function PriceGroup({
  initialMin,
  initialMax,
  onApply,
}: {
  initialMin: string;
  initialMax: string;
  onApply: (min: string, max: string) => void;
}) {
  const [open, setOpen] = useState(true);
  const panelId = useId();
  const hasBand = initialMin !== '' || initialMax !== '';

  return (
    <div className={`facet lst-facet${open ? ' open' : ''}`}>
      <button
        type="button"
        className="lst-facet-head"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen(o => !o)}
      >
        Price
        {hasBand ? <span className="lst-facet-dot" aria-hidden="true" /> : null}
        <span className="pm" aria-hidden="true">
          +
        </span>
      </button>
      <div id={panelId} className="lst-facet-panel">
        <div className="lst-facet-inner">
          {/* Key re-seeds the inputs when navigation changes the band. */}
          <form
            key={`${initialMin}|${initialMax}`}
            className="lst-price"
            onSubmit={e => {
              e.preventDefault();
              const data = new FormData(e.currentTarget);
              onApply(String(data.get('pmin') ?? ''), String(data.get('pmax') ?? ''));
            }}
          >
            <input
              className="input lst-price-input"
              type="number"
              name="pmin"
              min={0}
              inputMode="numeric"
              placeholder="Min"
              aria-label="Minimum price"
              defaultValue={initialMin}
            />
            <span className="lst-price-dash" aria-hidden="true">
              –
            </span>
            <input
              className="input lst-price-input"
              type="number"
              name="pmax"
              min={0}
              inputMode="numeric"
              placeholder="Max"
              aria-label="Maximum price"
              defaultValue={initialMax}
            />
            <button type="submit" className="btn btn-ghost btn-sm lst-price-go">
              Go
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
