'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Check } from 'lucide-react';
import { toast } from '@/components/storefront/overlays';
import { useCart, type VariantMeta } from '@/components/storefront/cart-context';
import {
  AXIS_SWATCHES,
  humanizeAxisKey,
  humanizeAxisValue,
} from '@/components/storefront/pdp-format';

/** Serializable variant shape passed from the PDP server component. */
export type PurchaseVariant = {
  id: string;
  sku: string;
  name: string | null;
  axes: Record<string, string | number>;
  priceCents: number;
  compareAtCents: number | null;
  status: 'draft' | 'active' | 'archived';
};

export type PurchaseProduct = {
  name: string;
  slug: string;
};

export type CurrencyConfig = { code: string; symbol?: string; locale: string };

function format(cents: number, cfg: CurrencyConfig): string {
  try {
    return new Intl.NumberFormat(cfg.locale, {
      style: 'currency',
      currency: cfg.code,
      maximumFractionDigits: cents % 100 === 0 ? 0 : 2,
    }).format(cents / 100);
  } catch {
    return `${cfg.symbol ?? ''}${(cents / 100).toFixed(2)}`;
  }
}

function axesOf(variant: PurchaseVariant): Record<string, string> {
  return Object.fromEntries(Object.entries(variant.axes).map(([k, v]) => [k, String(v)]));
}

/**
 * Client purchase panel: axis pickers (radiogroup pills/swatches), a price
 * block with a per-variant transition, qty stepper, and add-to-cart through
 * the cart context. Adding passes `VariantMeta` so the drawer — which opens
 * itself as the primary confirmation — can render real names/axes/thumbnails.
 * No success toast (per the motion/overlay contract); errors surface through
 * the overlays toast.
 */
export function ProductPurchasePanel({
  product,
  variants,
  currency,
}: {
  product: PurchaseProduct;
  variants: PurchaseVariant[];
  currency: CurrencyConfig;
}) {
  const activeVariants = useMemo(() => variants.filter(v => v.status === 'active'), [variants]);

  // Axis → ordered distinct values, derived from the active variant list.
  const axisKeys = useMemo(() => {
    const keys = new Set<string>();
    for (const v of activeVariants) {
      for (const k of Object.keys(v.axes)) keys.add(k);
    }
    return [...keys];
  }, [activeVariants]);

  const [selections, setSelections] = useState<Record<string, string>>(() => {
    const first = variants.find(v => v.status === 'active');
    return first ? axesOf(first) : {};
  });
  // Fallback picker for multi-variant products without axes (picked by name).
  const [fallbackId, setFallbackId] = useState<string>(
    () => variants.find(v => v.status === 'active')?.id ?? '',
  );
  const [qty, setQty] = useState(1);
  const [justAdded, setJustAdded] = useState(false);
  const addedTimer = useRef<number | null>(null);

  const { addItem, loading, registerVariantMeta } = useCart();

  const findVariant = useMemo(
    () =>
      (sel: Record<string, string>): PurchaseVariant | undefined =>
        activeVariants.find(v => axisKeys.every(k => String(v.axes[k]) === sel[k])),
    [activeVariants, axisKeys],
  );

  const selected: PurchaseVariant | null =
    axisKeys.length > 0
      ? (findVariant(selections) ?? null)
      : (activeVariants.find(v => v.id === fallbackId) ?? activeVariants[0] ?? null);

  // Prime the cart drawer's display-metadata registry for this product's
  // variants so previously-added lines render names/thumbnails after reloads.
  useEffect(() => {
    for (const v of activeVariants) {
      const meta: VariantMeta = { name: product.name, slug: product.slug };
      if (Object.keys(v.axes).length > 0) meta.axes = v.axes;
      registerVariantMeta(v.id, meta);
    }
  }, [activeVariants, product.name, product.slug, registerVariantMeta]);

  useEffect(
    () => () => {
      if (addedTimer.current !== null) window.clearTimeout(addedTimer.current);
    },
    [],
  );

  function selectAxis(key: string, value: string): void {
    const next = { ...selections, [key]: value };
    if (findVariant(next)) {
      setSelections(next);
      return;
    }
    // No variant for this exact combination — adopt the nearest variant that
    // carries the clicked value so the picker never dead-ends.
    const nearest = activeVariants.find(v => String(v.axes[key]) === value);
    if (nearest) setSelections(axesOf(nearest));
  }

  async function onAdd(): Promise<void> {
    if (!selected) return;
    const meta: VariantMeta = { name: product.name, slug: product.slug };
    if (Object.keys(selected.axes).length > 0) meta.axes = selected.axes;
    const ok = await addItem(selected.id, qty, meta);
    if (ok) {
      // The cart drawer opens itself — this is only the button's micro-confirmation.
      setJustAdded(true);
      if (addedTimer.current !== null) window.clearTimeout(addedTimer.current);
      addedTimer.current = window.setTimeout(() => setJustAdded(false), 1800);
    } else {
      toast({ title: 'Could not add to cart', description: 'Please try again in a moment.' });
    }
  }

  if (activeVariants.length === 0) {
    return <p className="muted">Currently unavailable.</p>;
  }

  const onSale =
    selected?.compareAtCents != null && selected.compareAtCents > selected.priceCents;
  const savings =
    onSale && selected ? (selected.compareAtCents as number) - selected.priceCents : 0;
  const savingsPct =
    onSale && selected
      ? Math.round((savings / (selected.compareAtCents as number)) * 100)
      : 0;

  return (
    <div className="pdp-panel">
      {/* Price */}
      <div className="pdp-price-block">
        {selected ? (
          <>
            <div className="pdp-price-row" aria-live="polite">
              <span key={selected.id} className="pdp-price price">
                {format(selected.priceCents, currency)}
              </span>
              {onSale ? (
                <>
                  <span className="strike price pdp-compare">
                    {format(selected.compareAtCents as number, currency)}
                  </span>
                  <span className="badge badge-sale">Save {savingsPct}%</span>
                </>
              ) : null}
            </div>
            <p className="meta pdp-price-note">
              Inclusive of all taxes
              {onSale ? (
                <>
                  {' '}
                  · <span className="pdp-save">You save {format(savings, currency)}</span>
                </>
              ) : null}
            </p>
          </>
        ) : null}
      </div>

      {/* Variant axes */}
      {axisKeys.length > 0 ? (
        <div className="pdp-axes">
          {axisKeys.map(key => {
            const values = [
              ...new Set(
                activeVariants.filter(v => key in v.axes).map(v => String(v.axes[key])),
              ),
            ];
            const labelId = `pdp-axis-${key}`;
            const current = selections[key];
            return (
              <div key={key} className="opt-group pdp-opt-group" role="radiogroup" aria-labelledby={labelId}>
                <div className="opt-label">
                  <span id={labelId}>{humanizeAxisKey(key)}</span>
                  {current !== undefined ? (
                    <span className="muted">{humanizeAxisValue(current)}</span>
                  ) : null}
                </div>
                <div className="opt-row">
                  {values.map(value => {
                    const isOn = current === value;
                    const isDim = !isOn && !findVariant({ ...selections, [key]: value });
                    const swatch =
                      key === 'color' ? AXIS_SWATCHES[value.toLowerCase()] : undefined;
                    return (
                      <button
                        key={value}
                        type="button"
                        role="radio"
                        aria-checked={isOn}
                        className={`opt-pill pdp-pill${isOn ? ' on' : ''}${isDim ? ' is-dim' : ''}`}
                        onClick={() => selectAxis(key, value)}
                      >
                        {swatch ? (
                          <span
                            className="pdp-swatch"
                            style={{ background: swatch }}
                            aria-hidden="true"
                          />
                        ) : null}
                        {humanizeAxisValue(value)}
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      ) : activeVariants.length > 1 ? (
        <div
          className="opt-group pdp-opt-group"
          role="radiogroup"
          aria-labelledby="pdp-axis-options"
        >
          <div className="opt-label">
            <span id="pdp-axis-options">Options</span>
          </div>
          <div className="opt-row">
            {activeVariants.map(v => (
              <button
                key={v.id}
                type="button"
                role="radio"
                aria-checked={selected?.id === v.id}
                className={`opt-pill pdp-pill${selected?.id === v.id ? ' on' : ''}`}
                onClick={() => setFallbackId(v.id)}
              >
                {v.name ?? v.sku}
              </button>
            ))}
          </div>
        </div>
      ) : null}

      {/* Qty + add */}
      <div className="buy-row pdp-buy-row">
        <div className="stepper" aria-label="Quantity">
          <button
            type="button"
            onClick={() => setQty(q => Math.max(1, q - 1))}
            disabled={qty <= 1}
            aria-label="Decrease quantity"
          >
            −
          </button>
          <span aria-live="polite">{qty}</span>
          <button
            type="button"
            onClick={() => setQty(q => Math.min(99, q + 1))}
            aria-label="Increase quantity"
          >
            +
          </button>
        </div>
        <button
          type="button"
          className={`btn btn-clay btn-lg pdp-add${justAdded ? ' is-added' : ''}`}
          onClick={() => void onAdd()}
          disabled={loading || !selected}
        >
          {justAdded ? (
            <>
              Added <Check aria-hidden size={16} strokeWidth={2.25} />
            </>
          ) : loading ? (
            'Adding…'
          ) : (
            <>
              Add to cart <span className="arr">→</span>
            </>
          )}
        </button>
      </div>

      {/* Availability + SKU */}
      <div className="pdp-substrip meta">
        <span className="pdp-stock">
          <span className="dot" aria-hidden="true" /> In stock — ready to ship
        </span>
        {selected ? <span className="pdp-sku">SKU {selected.sku}</span> : null}
      </div>
    </div>
  );
}
