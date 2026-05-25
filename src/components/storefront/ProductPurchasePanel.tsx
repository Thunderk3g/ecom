'use client';

import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useCart } from '@/components/storefront/cart-context';

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

export type CurrencyConfig = { code: string; symbol?: string; locale: string };

function format(cents: number, cfg: CurrencyConfig): string {
  try {
    return new Intl.NumberFormat(cfg.locale, { style: 'currency', currency: cfg.code }).format(
      cents / 100,
    );
  } catch {
    return `${cfg.symbol ?? ''}${(cents / 100).toFixed(2)}`;
  }
}

/**
 * Client purchase panel: variant picker + price block + add-to-cart. Add-to-cart
 * goes through the cart context (→ existing cart HTTP API). Variant axes are
 * rendered as button groups derived from the variant list.
 */
export function ProductPurchasePanel({
  variants,
  currency,
}: {
  variants: PurchaseVariant[];
  currency: CurrencyConfig;
}) {
  const activeVariants = useMemo(() => variants.filter(v => v.status === 'active'), [variants]);
  const [selectedId, setSelectedId] = useState<string>(activeVariants[0]?.id ?? '');
  const [qty, setQty] = useState(1);
  const { addItem, loading } = useCart();

  const selected = activeVariants.find(v => v.id === selectedId) ?? null;

  // Build axis → distinct values map for the picker (only when axes exist).
  const axisKeys = useMemo(() => {
    const keys = new Set<string>();
    for (const v of activeVariants) {
      for (const k of Object.keys(v.axes)) keys.add(k);
    }
    return [...keys];
  }, [activeVariants]);

  async function onAdd(): Promise<void> {
    if (!selected) return;
    const ok = await addItem(selected.id, qty);
    if (ok) {
      toast.success('Added to cart');
    } else {
      toast.error('Could not add to cart');
    }
  }

  if (activeVariants.length === 0) {
    return <p className="text-muted-foreground">Currently unavailable.</p>;
  }

  const onSale =
    selected?.compareAtCents != null && selected.compareAtCents > selected.priceCents;

  return (
    <div className="space-y-6">
      <div className="flex items-baseline gap-3">
        {selected ? (
          <>
            <span className="text-2xl font-semibold">{format(selected.priceCents, currency)}</span>
            {onSale ? (
              <>
                <span className="text-muted-foreground line-through">
                  {format(selected.compareAtCents as number, currency)}
                </span>
                <Badge variant="secondary">Sale</Badge>
              </>
            ) : null}
          </>
        ) : null}
      </div>

      {axisKeys.length > 0 ? (
        <div className="space-y-4">
          {axisKeys.map(key => {
            const values = [...new Set(activeVariants.map(v => String(v.axes[key])))];
            return (
              <div key={key} className="space-y-2">
                <span className="text-sm font-medium capitalize">{key}</span>
                <div className="flex flex-wrap gap-2">
                  {values.map(value => {
                    const variantForValue = activeVariants.find(
                      v => String(v.axes[key]) === value,
                    );
                    const isSelected =
                      selected != null && String(selected.axes[key]) === value;
                    return (
                      <Button
                        key={value}
                        type="button"
                        variant={isSelected ? 'default' : 'outline'}
                        size="sm"
                        onClick={() => variantForValue && setSelectedId(variantForValue.id)}
                      >
                        {value}
                      </Button>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        activeVariants.length > 1 && (
          <div className="space-y-2">
            <span className="text-sm font-medium">Options</span>
            <div className="flex flex-wrap gap-2">
              {activeVariants.map(v => (
                <Button
                  key={v.id}
                  type="button"
                  variant={selectedId === v.id ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => setSelectedId(v.id)}
                >
                  {v.name ?? v.sku}
                </Button>
              ))}
            </div>
          </div>
        )
      )}

      <div className="flex items-center gap-3">
        <div className="flex items-center rounded-md border">
          <button
            type="button"
            className="px-3 py-2 text-lg leading-none hover:bg-accent"
            onClick={() => setQty(q => Math.max(1, q - 1))}
            aria-label="Decrease quantity"
          >
            −
          </button>
          <span className="w-10 text-center text-sm tabular-nums">{qty}</span>
          <button
            type="button"
            className="px-3 py-2 text-lg leading-none hover:bg-accent"
            onClick={() => setQty(q => q + 1)}
            aria-label="Increase quantity"
          >
            +
          </button>
        </div>
        <Button type="button" size="lg" onClick={onAdd} disabled={loading || !selected}>
          {loading ? 'Adding…' : 'Add to cart'}
        </Button>
      </div>
      {selected ? (
        <p className="text-xs text-muted-foreground">SKU: {selected.sku}</p>
      ) : null}
    </div>
  );
}
