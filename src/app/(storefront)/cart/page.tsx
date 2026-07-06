'use client';

import Link from 'next/link';
import { useState } from 'react';
import { Gift, Lock, NotebookPen, Trophy } from 'lucide-react';
import { toast, formatMinor } from '@/components/storefront/overlays';
import { useCart, type CartLine } from '@/components/storefront/cart-context';
import { MediaPlaceholder } from '@/components/storefront/MediaPlaceholder';
import { humanizeAxisValue } from '@/components/storefront/pdp-format';
import { getProductImage } from '@/utils/storefront-assets';

/**
 * Full cart view. Client component reading/writing the cart through the cart
 * context (→ existing cart HTTP API). Priced lines come from the server totals
 * (authoritative); display names/axes/thumbnails come from the variant
 * display-metadata registry the PDP primes on add-to-cart. Quantity edits are
 * optimistic (pending value renders immediately, server response reconciles).
 *
 * Cross-sell rail intentionally omitted: this page is fully client-rendered,
 * so there is no server-side product data to source it from.
 */

/** Mirrors the CartDrawer default — ₹999 in paise. */
const FREE_SHIPPING_THRESHOLD_CENTS = 99_900;

const DEPARTMENTS = [
  { label: 'Stationery', href: '/c/stationery' },
  { label: 'Sports', href: '/c/sports' },
  { label: 'Art & Craft', href: '/c/art-craft' },
  { label: 'Gifting', href: '/c/gifting' },
] as const;

export default function CartPage() {
  const {
    cart,
    totals,
    ready,
    loading,
    error,
    updateItem,
    removeItem,
    applyCoupon,
    removeCoupon,
    variantMeta,
  } = useCart();
  const [coupon, setCoupon] = useState('');
  const [applying, setApplying] = useState(false);
  const [pendingQty, setPendingQty] = useState<Record<string, number>>({});

  const fmt = (cents: number): string => formatMinor(cents, cart?.currency);

  const lines = totals?.lines ?? [];
  const isEmpty = lines.length === 0;
  const itemQtyById = new Map((cart?.items ?? []).map(i => [i.id, i.qty]));

  const subtotal = totals?.subtotalCents ?? 0;
  const fsRemaining = Math.max(0, FREE_SHIPPING_THRESHOLD_CENTS - subtotal);
  const fsProgress = Math.min(1, subtotal / FREE_SHIPPING_THRESHOLD_CENTS);
  const fsUnlocked = !isEmpty && fsRemaining === 0;

  async function onStep(line: CartLine, delta: number): Promise<void> {
    const current = pendingQty[line.itemId] ?? itemQtyById.get(line.itemId) ?? line.qty;
    const next = current + delta;
    if (next <= 0) {
      await onRemove(line);
      return;
    }
    setPendingQty(p => ({ ...p, [line.itemId]: next }));
    await updateItem(line.itemId, next);
    setPendingQty(p => {
      const { [line.itemId]: _done, ...rest } = p;
      return rest;
    });
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

  async function onApplyCoupon(): Promise<void> {
    const code = coupon.trim();
    if (!code) return;
    setApplying(true);
    const ok = await applyCoupon(code);
    setApplying(false);
    if (ok) {
      toast({ title: 'Coupon applied', description: code.toUpperCase() });
      setCoupon('');
    } else {
      toast({ title: 'Coupon could not be applied', description: error ?? undefined });
    }
  }

  if (!ready) {
    return (
      <main className="wrap-wide">
        <div className="section center muted">Loading cart…</div>
      </main>
    );
  }

  return (
    <main className="wrap-wide cartp">
      <nav className="crumbs" aria-label="Breadcrumb" style={{ paddingTop: 18 }}>
        <Link href="/">Home</Link>
        <span className="sep">/</span>
        <span aria-current="page" style={{ color: 'var(--ink)' }}>
          Cart
        </span>
      </nav>

      <div className="between cartp-head">
        <h1 className="h-lg">
          Your cart{' '}
          {!isEmpty ? (
            <span className="muted cartp-count">
              · {lines.length} {lines.length === 1 ? 'item' : 'items'}
            </span>
          ) : null}
        </h1>
        <Link href="/search" className="ucap link-u muted">
          Continue shopping
        </Link>
      </div>

      {isEmpty ? (
        <section className="cartp-empty">
          <div className="cartp-empty-art" aria-hidden="true">
            <span className="cartp-empty-tile t1">
              <NotebookPen aria-hidden size={26} strokeWidth={1.4} />
            </span>
            <span className="cartp-empty-tile t2">
              <Trophy aria-hidden size={26} strokeWidth={1.4} />
            </span>
            <span className="cartp-empty-tile t3">
              <Gift aria-hidden size={26} strokeWidth={1.4} />
            </span>
          </div>
          <h2 className="h-md">Your cart is empty</h2>
          <p className="muted cartp-empty-copy">
            Fill it with fresh notebooks, fine pens and match-day gear.
          </p>
          <Link href="/search" className="btn btn-clay">
            Browse products <span className="arr">→</span>
          </Link>
          <div className="cartp-empty-depts">
            {DEPARTMENTS.map(dept => (
              <Link key={dept.href} href={dept.href} className="chip">
                {dept.label}
              </Link>
            ))}
          </div>
        </section>
      ) : (
        <div className="cart-grid">
          {/* Line items */}
          <div>
            <div
              className={fsUnlocked ? 'cartp-fs done' : 'cartp-fs'}
              aria-live="polite"
            >
              <p className="cartp-fs-label">
                {fsUnlocked ? (
                  <>
                    <strong>Free shipping unlocked</strong> — nice one! ✓
                  </>
                ) : (
                  <>
                    You&rsquo;re <strong>{fmt(fsRemaining)}</strong> away from free shipping
                  </>
                )}
              </p>
              <div
                className="cartp-fs-track"
                role="progressbar"
                aria-label="Progress toward free shipping"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={Math.round(fsProgress * 100)}
              >
                <div className="cartp-fs-bar" style={{ transform: `scaleX(${fsProgress})` }} />
              </div>
            </div>

            {lines.map(line => {
              const meta = variantMeta[line.variantId];
              const image = meta?.image ?? (meta?.slug ? getProductImage(meta.slug) : null);
              const name = meta?.name ?? `Item ${line.variantId.slice(0, 8)}`;
              const axes = meta?.axes
                ? Object.values(meta.axes).map(humanizeAxisValue).filter(Boolean)
                : [];
              const qty = pendingQty[line.itemId] ?? itemQtyById.get(line.itemId) ?? line.qty;
              const discounted = line.lineDiscountCents > 0;

              return (
                <article key={line.itemId} className="cart-row cartp-row">
                  <div className="cartp-thumb">
                    {image ? (
                      <img src={image} alt="" loading="lazy" />
                    ) : meta ? (
                      <MediaPlaceholder
                        label={name}
                        {...(meta.slug ? { slug: meta.slug } : {})}
                        aspect="1/1"
                        showLabel={false}
                      />
                    ) : (
                      <div className="ph clean" aria-hidden="true" />
                    )}
                  </div>

                  <div className="cartp-main">
                    {meta?.slug ? (
                      <Link href={`/p/${meta.slug}`} className="cartp-name underline-slide">
                        {name}
                      </Link>
                    ) : (
                      <span className="cartp-name">{name}</span>
                    )}
                    {axes.length > 0 ? (
                      <div className="meta cartp-axes">{axes.join(' · ')}</div>
                    ) : null}
                    <div className="meta">{fmt(line.unitPriceCents)} each</div>

                    <div className="row cartp-controls">
                      <div className="stepper cartp-stepper">
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
                        className="rmv"
                        disabled={loading}
                        onClick={() => void onRemove(line)}
                      >
                        Remove
                      </button>
                    </div>
                  </div>

                  <div className="cartp-line-total">
                    {discounted ? (
                      <span className="strike price cartp-line-was">
                        {fmt(line.lineSubtotalCents)}
                      </span>
                    ) : null}
                    <span className="price">{fmt(line.lineTotalCents)}</span>
                  </div>
                </article>
              );
            })}
          </div>

          {/* Summary */}
          <aside className="summary">
            <div className="surface pad cartp-summary">
              <h2 className="h-md cartp-summary-title">Order summary</h2>

              {cart?.couponCode ? (
                <div className="row cartp-coupon-applied">
                  <span className="badge badge-good">✓ {cart.couponCode} applied</span>
                  <button
                    type="button"
                    className="rmv"
                    disabled={loading}
                    onClick={() => void removeCoupon()}
                  >
                    Remove
                  </button>
                </div>
              ) : (
                <>
                  <label className="flabel" htmlFor="coupon">
                    Discount code
                  </label>
                  <div className="coupon">
                    <input
                      id="coupon"
                      className="input"
                      value={coupon}
                      onChange={e => setCoupon(e.target.value)}
                      onKeyDown={e => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          void onApplyCoupon();
                        }
                      }}
                      placeholder="e.g. WELCOME10"
                      autoComplete="off"
                    />
                    <button
                      type="button"
                      className="btn btn-ghost"
                      disabled={applying || coupon.trim().length === 0}
                      onClick={() => void onApplyCoupon()}
                    >
                      {applying ? 'Applying…' : 'Apply'}
                    </button>
                  </div>
                </>
              )}

              {totals && totals.appliedPromotions.length > 0 ? (
                <ul className="cartp-promos">
                  {totals.appliedPromotions.map((promo, i) => (
                    <li key={promo.code ?? promo.label ?? i} className="meta">
                      <span className="dot" aria-hidden="true" />{' '}
                      {promo.label ?? promo.code ?? 'Promotion'}
                      {promo.freeShipping ? ' — free shipping' : ''}
                    </li>
                  ))}
                </ul>
              ) : null}

              <hr className="divider cartp-divider" />
              <div className="sum-line">
                <span>Subtotal</span>
                <span className="price">{fmt(subtotal)}</span>
              </div>
              {totals && totals.discountCents > 0 ? (
                <div className="sum-line">
                  <span>Discount</span>
                  <span className="price cartp-good">−{fmt(totals.discountCents)}</span>
                </div>
              ) : null}
              <div className="sum-line">
                <span>Tax</span>
                <span className="price muted">{fmt(totals?.taxCents ?? 0)}</span>
              </div>
              <div className="sum-line">
                <span>
                  Shipping
                  {totals?.shippingOption ? ` (${totals.shippingOption.label})` : ''}
                </span>
                {totals?.shippingOption ? (
                  <span className="price">
                    {totals.shippingCents === 0 ? (
                      <span className="cartp-good">Free</span>
                    ) : (
                      fmt(totals.shippingCents)
                    )}
                  </span>
                ) : (
                  <span className="muted">At checkout</span>
                )}
              </div>
              <div className="sum-line total">
                <span>Total</span>
                <span className="price">{fmt(totals?.totalCents ?? 0)}</span>
              </div>

              <Link href="/checkout" className="btn btn-clay btn-block btn-lg cartp-cta">
                Checkout securely <span className="arr">→</span>
              </Link>
              <div className="cartp-assure meta">
                <span className="cartp-assure-item">
                  <Lock aria-hidden size={13} strokeWidth={1.8} /> Secure checkout
                </span>
                <span aria-hidden="true">·</span>
                <span>Razorpay / Stripe</span>
                <span aria-hidden="true">·</span>
                <span>COD up to ₹5,000</span>
              </div>
            </div>
          </aside>
        </div>
      )}
    </main>
  );
}
