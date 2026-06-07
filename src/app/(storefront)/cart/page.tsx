'use client';

import Link from 'next/link';
import { useState } from 'react';
import { toast } from 'sonner';
import { useCart, type CartLine } from '@/components/storefront/cart-context';

/**
 * Full cart view. Client component reading/writing the cart through the cart
 * context (→ existing cart HTTP API). Line items show the priced line from the
 * server totals (authoritative). Quantity edits, removal, and coupon
 * apply/remove all round-trip and re-render from the server response.
 *
 * Money is formatted from the cart's currency code; the storefront site_config
 * currency is the source for the symbol/locale but the cart row also carries a
 * currency so we read it directly here (client has no site_config access).
 */
function useCurrencyFormatter(code: string | undefined): (cents: number) => string {
  return (cents: number) => {
    const value = cents / 100;
    try {
      return new Intl.NumberFormat(undefined, {
        style: 'currency',
        currency: code ?? 'INR',
      }).format(value);
    } catch {
      return value.toFixed(2);
    }
  };
}

export default function CartPage() {
  const { cart, totals, ready, loading, updateItem, removeItem, applyCoupon, removeCoupon } =
    useCart();
  const [coupon, setCoupon] = useState('');
  const fmt = useCurrencyFormatter(cart?.currency);

  if (!ready) {
    return (
      <main className="wrap-wide">
        <div className="section" style={{ textAlign: 'center', color: 'var(--ink-3)' }}>
          Loading cart…
        </div>
      </main>
    );
  }

  const lines = totals?.lines ?? [];
  const isEmpty = lines.length === 0;

  // Map item rows by id so we can pair priced lines with their cart item.
  const itemById = new Map((cart?.items ?? []).map(i => [i.id, i]));

  async function onApplyCoupon(): Promise<void> {
    if (!coupon.trim()) return;
    const ok = await applyCoupon(coupon.trim());
    if (ok) {
      toast.success('Coupon applied');
      setCoupon('');
    } else {
      toast.error('Coupon could not be applied');
    }
  }

  return (
    <main className="wrap-wide">
      <div className="crumbs" style={{ paddingTop: 18 }}>
        <a href="/">Home</a>
        <span className="sep">/</span>
        <span style={{ color: 'var(--ink)' }}>Cart</span>
      </div>
      <div className="between" style={{ margin: '18px 0 4px', alignItems: 'flex-end' }}>
        <h1 className="h-lg">
          Your cart{' '}
          {!isEmpty ? (
            <span
              className="muted"
              style={{ fontFamily: 'var(--sans)', fontSize: 18, fontWeight: 500 }}
            >
              · {lines.length} {lines.length === 1 ? 'item' : 'items'}
            </span>
          ) : null}
        </h1>
        <Link href="/search" className="ucap link-u muted">
          Continue shopping
        </Link>
      </div>

      {isEmpty ? (
        <div className="section" style={{ textAlign: 'center' }}>
          <p className="muted" style={{ marginBottom: 18 }}>
            Your cart is empty.
          </p>
          <Link href="/search" className="btn btn-clay">
            Browse products <span className="arr">→</span>
          </Link>
        </div>
      ) : (
        <div className="cart-grid">
          {/* Line items */}
          <div>
            {lines.map((line: CartLine) => {
              const item = itemById.get(line.itemId);
              return (
                <div key={line.itemId} className="cart-row">
                  <div className="ph" data-label="item" />
                  <div>
                    <a
                      href="#"
                      style={{
                        fontWeight: 600,
                        fontSize: 15,
                        display: 'block',
                        margin: '3px 0 2px',
                      }}
                    >
                      Variant {line.variantId.slice(0, 8)}
                    </a>
                    <div className="meta" style={{ marginBottom: 12 }}>
                      {fmt(line.unitPriceCents)} each
                    </div>
                    <div className="row" style={{ gap: 18 }}>
                      <div
                        className="stepper"
                        style={{ transform: 'scale(.9)', transformOrigin: 'left' }}
                      >
                        <button
                          type="button"
                          disabled={loading}
                          onClick={() => updateItem(line.itemId, line.qty - 1)}
                          aria-label="Decrease quantity"
                        >
                          −
                        </button>
                        <span>{item?.qty ?? line.qty}</span>
                        <button
                          type="button"
                          disabled={loading}
                          onClick={() => updateItem(line.itemId, line.qty + 1)}
                          aria-label="Increase quantity"
                        >
                          +
                        </button>
                      </div>
                      <button
                        type="button"
                        className="rmv"
                        disabled={loading}
                        onClick={() => removeItem(line.itemId)}
                      >
                        Remove
                      </button>
                    </div>
                  </div>
                  <div style={{ textAlign: 'right', fontWeight: 600, fontSize: 15 }}>
                    {fmt(line.lineTotalCents)}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Summary */}
          <aside className="summary">
            <div className="surface pad">
              <h3 className="h-md" style={{ fontFamily: 'var(--serif)', marginBottom: 16 }}>
                Order summary
              </h3>

              {cart?.couponCode ? (
                <div className="row" style={{ gap: 8, marginBottom: 16 }}>
                  <span className="badge badge-good">✓ {cart.couponCode} applied</span>
                  <button
                    type="button"
                    className="rmv"
                    onClick={() => removeCoupon()}
                  >
                    Remove
                  </button>
                </div>
              ) : (
                <>
                  <div className="field" style={{ marginBottom: 6 }}>
                    <label htmlFor="coupon">Discount code</label>
                  </div>
                  <div className="coupon">
                    <input
                      id="coupon"
                      className="input"
                      value={coupon}
                      onChange={e => setCoupon(e.target.value)}
                      placeholder="e.g. WELCOME10"
                    />
                    <button type="button" className="btn btn-ghost" onClick={onApplyCoupon}>
                      Apply
                    </button>
                  </div>
                </>
              )}

              <hr className="divider" style={{ margin: '4px 0 8px' }} />
              <div className="sum-line">
                <span>Subtotal</span>
                <span className="price">{fmt(totals?.subtotalCents ?? 0)}</span>
              </div>
              {totals && totals.discountCents > 0 ? (
                <div className="sum-line">
                  <span>Discount</span>
                  <span className="price" style={{ color: 'var(--good)' }}>
                    −{fmt(totals.discountCents)}
                  </span>
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
                <span className="price">{fmt(totals?.shippingCents ?? 0)}</span>
              </div>
              <div className="sum-line total">
                <span>Total</span>
                <span className="price">{fmt(totals?.totalCents ?? 0)}</span>
              </div>

              <Link
                href="/checkout"
                className="btn btn-clay btn-block btn-lg"
                style={{ marginTop: 18 }}
              >
                Checkout securely <span className="arr">→</span>
              </Link>
              <div
                className="row"
                style={{ justifyContent: 'center', gap: 14, marginTop: 16 }}
              >
                <span className="meta">🔒 Secure checkout</span>
                <span className="meta">·</span>
                <span className="meta">Razorpay / Stripe</span>
              </div>
            </div>
          </aside>
        </div>
      )}
    </main>
  );
}
