'use client';

import { useState } from 'react';
import { useCart } from '@/components/storefront/cart-context';
import { toast } from '@/components/storefront/overlays';

/**
 * One-tap add-to-cart for single-variant products on listing cards.
 * `addItem` opens the cart drawer itself on success (that IS the
 * confirmation — no success toast); a toast fires only on failure.
 */
export function QuickAdd({
  variantId,
  name,
  slug,
  axes,
}: {
  variantId: string;
  name: string;
  slug: string;
  axes?: Record<string, string | number>;
}) {
  const { addItem } = useCart();
  const [busy, setBusy] = useState(false);

  const onAdd = async () => {
    if (busy) return;
    setBusy(true);
    const ok = await addItem(variantId, 1, { name, slug, ...(axes ? { axes } : {}) });
    setBusy(false);
    if (!ok) {
      toast({ title: 'Could not add to cart', description: 'Please try again.' });
    }
  };

  return (
    <button type="button" className="add" disabled={busy} aria-busy={busy} onClick={onAdd}>
      {busy ? 'Adding…' : 'Add to cart'}
    </button>
  );
}
