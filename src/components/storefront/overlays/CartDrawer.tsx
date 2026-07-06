'use client';

import Link from 'next/link';
import { useMemo, useRef } from 'react';
import { ShoppingBag, X } from 'lucide-react';
import { useCart, type CartLine } from '@/components/storefront/cart-context';
import { getProductImage } from '@/utils/storefront-assets';
import { useOverlay, formatMinor } from './overlay-utils';
import { useToast } from './Toaster';

/**
 * Cart drawer — right slide-over opened by the header cart button and
 * automatically after every successful add-to-cart (see cart-context).
 *
 * Renders Plume's `.cart-scrim` / `.cart-drawer` shell with:
 * - line items (thumbnail via variant display metadata → `getProductImage`),
 *   variant axes, qty stepper, remove (fires a "Removed from cart" toast),
 * - a free-shipping progress bar toward `freeShippingThresholdCents`
 *   (default ₹999) that celebrates when the threshold is crossed,
 * - subtotal + Checkout CTA + quiet "View cart" link,
 * - a friendly empty state.
 *
 * Focus trap / Escape / scroll lock / focus return come from `useOverlay`.
 */
export function CartDrawer({
  freeShippingThresholdCents = 99_900,
}: {
  /** Free-shipping threshold in minor units (default 99900 = ₹999). */
  freeShippingThresholdCents?: number;
}) {
  const {
    cart,
    totals,
    count,
    loading,
    isDrawerOpen,
    closeDrawer,
    updateItem,
    removeItem,
    variantMeta,
  } = useCart();
  const { toast } = useToast();
  const panelRef = useRef<HTMLElement | null>(null);

  useOverlay({ open: isDrawerOpen, onClose: closeDrawer, panelRef });

  const fmt = (cents: number): string => formatMinor(cents, cart?.currency);
  const lines = totals?.lines ?? [];
  const isEmpty = lines.length === 0;

  const itemQtyById = useMemo(
    () => new Map((cart?.items ?? []).map(i => [i.id, i.qty])),
    [cart],
  );

  const subtotal = totals?.subtotalCents ?? 0;
  const remaining = Math.max(0, freeShippingThresholdCents - subtotal);
  const progress =
    freeShippingThresholdCents > 0
      ? Math.min(1, subtotal / freeShippingThresholdCents)
      : 1;
  const unlocked = !isEmpty && remaining === 0;

  async function onStep(line: CartLine, delta: number): Promise<void> {
    const nextQty = line.qty + delta;
    if (nextQty <= 0) {
      await onRemove(line);
      return;
    }
    await updateItem(line.itemId, nextQty);
  }

  async function onRemove(line: CartLine): Promise<void> {
    const meta = variantMeta[line.variantId];
    const ok = await removeItem(line.itemId);
    if (ok) {
      toast({
        title: 'Removed from cart',
        ...(meta ? { description: meta.name } : {}),
      });
    }
  }

  return (
    <>
      <div
        className={isDrawerOpen ? 'cart-scrim open' : 'cart-scrim'}
        onClick={closeDrawer}
        aria-hidden="true"
      />
      <aside
        id="cart-drawer"
        ref={panelRef}
        className={isDrawerOpen ? 'cart-drawer open' : 'cart-drawer'}
        role="dialog"
        aria-modal="true"
        aria-label="Shopping cart"
        inert={!isDrawerOpen}
      >
        <div className="cart-head between">
          <h2 className="h-md">
            Your cart{' '}
            {count > 0 ? (
              <span className="muted" style={{ fontFamily: 'var(--sans)', fontSize: 14 }}>
                · {count} {count === 1 ? 'item' : 'items'}
              </span>
            ) : null}
          </h2>
          <button type="button" className="icon-btn" onClick={closeDrawer}>
            <X aria-hidden />
            <span className="sr-only">Close cart</span>
          </button>
        </div>

        {isEmpty ? (
          <div className="cart-empty">
            <div className="cart-empty-art" aria-hidden="true">
              <ShoppingBag aria-hidden />
            </div>
            <h3 className="h-md">Your cart is empty</h3>
            <p className="meta" style={{ maxWidth: '26ch' }}>
              Fill it with fresh notebooks, fine pens and match-day gear.
            </p>
            <Link
              href="/search"
              className="btn btn-clay"
              style={{ marginTop: 14 }}
              onClick={closeDrawer}
            >
              Browse the shop <span className="arr">→</span>
            </Link>
          </div>
        ) : (
          <>
            <div className={unlocked ? 'fs-strip done' : 'fs-strip'}>
              <p className="fs-label" aria-live="polite">
                {unlocked ? (
                  <>Free shipping unlocked — nice one! ✓</>
                ) : (
                  <>
                    You&rsquo;re <strong>{fmt(remaining)}</strong> away from free shipping
                  </>
                )}
              </p>
              <div
                className="fs-track"
                role="progressbar"
                aria-label="Progress toward free shipping"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={Math.round(progress * 100)}
              >
                <div className="fs-bar" style={{ transform: `scaleX(${progress})` }} />
              </div>
            </div>

            <div className="cart-body">
              {lines.map(line => {
                const meta = variantMeta[line.variantId];
                const image =
                  meta?.image ?? (meta?.slug ? getProductImage(meta.slug) : null);
                const name = meta?.name ?? `Item ${line.variantId.slice(0, 8)}`;
                const axes = meta?.axes
                  ? Object.values(meta.axes).map(String).filter(Boolean)
                  : [];
                const qty = itemQtyById.get(line.itemId) ?? line.qty;

                return (
                  <div className="cart-line" key={line.itemId}>
                    <div className="cart-thumb">
                      {image ? (
                        // eslint-disable-next-line @next/next/no-img-element -- small local thumbnail; next/image is overkill in the drawer
                        <img src={image} alt="" loading="lazy" />
                      ) : (
                        <div className="ph clean" aria-hidden="true" />
                      )}
                    </div>
                    <div className="cart-line-main">
                      <div className="cart-line-name">{name}</div>
                      {axes.length > 0 ? (
                        <div className="cart-line-axes">{axes.join(' · ')}</div>
                      ) : null}
                      <div className="meta">{fmt(line.unitPriceCents)} each</div>
                      <div className="row" style={{ gap: 14, marginTop: 6 }}>
                        <div className="stepper stepper-sm">
                          <button
                            type="button"
                            disabled={loading}
                            onClick={() => void onStep(line, -1)}
                            aria-label={`Decrease quantity of ${name}`}
                          >
                            −
                          </button>
                          <span aria-live="polite">{qty}</span>
                          <button
                            type="button"
                            disabled={loading}
                            onClick={() => void onStep(line, +1)}
                            aria-label={`Increase quantity of ${name}`}
                          >
                            +
                          </button>
                        </div>
                        <button
                          type="button"
                          className="cart-line-rmv"
                          disabled={loading}
                          onClick={() => void onRemove(line)}
                        >
                          Remove
                        </button>
                      </div>
                    </div>
                    <div className="cart-line-total price">{fmt(line.lineTotalCents)}</div>
                  </div>
                );
              })}
            </div>

            <div className="cart-foot">
              <div className="between" style={{ marginBottom: 4 }}>
                <span style={{ fontWeight: 600, fontSize: 14 }}>Subtotal</span>
                <span className="price" style={{ fontWeight: 600, fontSize: 15 }}>
                  {fmt(subtotal)}
                </span>
              </div>
              <p className="meta" style={{ margin: '0 0 14px' }}>
                Taxes and shipping calculated at checkout.
              </p>
              <Link
                href="/checkout"
                className="btn btn-clay btn-block btn-lg"
                onClick={closeDrawer}
              >
                Checkout <span className="arr">→</span>
              </Link>
              <div className="cart-foot-links">
                <Link href="/cart" className="btn btn-quiet btn-sm" onClick={closeDrawer}>
                  View cart
                </Link>
              </div>
            </div>
          </>
        )}
      </aside>
    </>
  );
}
