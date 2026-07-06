'use client';

import Link from 'next/link';
import { useState, type FormEvent } from 'react';
import { Banknote, Lock, RotateCcw, ShieldCheck } from 'lucide-react';
import { toast, formatMinor } from '@/components/storefront/overlays';
import { useCart } from '@/components/storefront/cart-context';
import { MediaPlaceholder } from '@/components/storefront/MediaPlaceholder';
import { humanizeAxisValue } from '@/components/storefront/pdp-format';
import { Reveal } from '@/components/storefront/motion';
import { getProductImage } from '@/utils/storefront-assets';
import { ensureStorefrontSession } from '../_lib/session';

type Provider = 'razorpay' | 'stripe';

type Address = {
  name: string;
  line1: string;
  line2: string;
  city: string;
  region: string;
  postal: string;
  country: string;
  phone: string;
};

type StartResult = {
  intentId: string;
  providerRef: string;
  clientSecret?: string;
  totals: { totalCents: number };
};

const EMPTY_ADDRESS: Address = {
  name: '',
  line1: '',
  line2: '',
  city: '',
  region: '',
  postal: '',
  country: 'IN',
  phone: '',
};

function newKey(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

/**
 * Single-page checkout (client). Steps, all against the existing HTTP API:
 *   1. Collect shipping address → PATCH /api/v1/cart/:id/addresses.
 *   2. Pick a provider → POST /api/v1/checkout/start (server re-prices,
 *      reserves stock, mints the intent).
 *   3. Show the returned payment intent. Live payment capture is out of scope
 *      (no keys), so this stubs the confirmation with a "simulate paid" note —
 *      the payment webhook is the real source of truth for order creation.
 *
 * This revision is presentation-only: request payloads, endpoints, field
 * semantics and the submit flow are unchanged.
 */
export default function CheckoutPage() {
  const { cart, totals, ready, variantMeta } = useCart();
  const [address, setAddress] = useState<Address>(EMPTY_ADDRESS);
  const [provider, setProvider] = useState<Provider>('razorpay');
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<StartResult | null>(null);

  function set<K extends keyof Address>(key: K, value: string): void {
    setAddress(a => ({ ...a, [key]: value }));
  }

  function money(cents: number): string {
    return formatMinor(cents, cart?.currency);
  }

  async function onSubmit(e: FormEvent<HTMLFormElement>): Promise<void> {
    e.preventDefault();
    if (!cart) {
      toast({ title: 'Your cart is empty' });
      return;
    }
    setSubmitting(true);
    try {
      const { csrfToken } = await ensureStorefrontSession();

      // 1. Persist the shipping address (also used as billing).
      const shipping = {
        name: address.name,
        line1: address.line1,
        ...(address.line2 ? { line2: address.line2 } : {}),
        city: address.city,
        region: address.region,
        postal: address.postal,
        country: address.country,
        ...(address.phone ? { phone: address.phone } : {}),
      };
      const addrRes = await fetch(`/api/v1/cart/${cart.id}/addresses`, {
        method: 'PATCH',
        credentials: 'include',
        headers: {
          'content-type': 'application/json',
          'x-csrf-token': csrfToken,
          'idempotency-key': newKey(),
        },
        body: JSON.stringify({ shippingAddress: shipping, billingAddress: shipping }),
      });
      if (!addrRes.ok) {
        toast({ title: 'Could not save address', description: 'Please check your details and try again.' });
        return;
      }

      // 2. Start checkout.
      const startRes = await fetch('/api/v1/checkout/start', {
        method: 'POST',
        credentials: 'include',
        headers: {
          'content-type': 'application/json',
          'x-csrf-token': csrfToken,
          'idempotency-key': newKey(),
        },
        body: JSON.stringify({ cartId: cart.id, provider }),
      });
      if (!startRes.ok) {
        const body = (await startRes.json().catch(() => ({}))) as { detail?: string };
        toast({
          title: 'Checkout could not be started',
          ...(body.detail ? { description: body.detail } : {}),
        });
        return;
      }
      const json = (await startRes.json()) as { data: StartResult };
      setResult(json.data);
    } finally {
      setSubmitting(false);
    }
  }

  if (!ready) {
    return (
      <main className="wrap-wide">
        <div className="section center muted">Loading…</div>
      </main>
    );
  }

  if (!cart || (totals?.lines.length ?? 0) === 0) {
    if (!result) {
      return (
        <main className="wrap-wide">
          <div className="section center">
            <p className="muted" style={{ marginBottom: 18 }}>
              Your cart is empty.
            </p>
            <Link href="/search" className="btn btn-clay">
              Browse products <span className="arr">→</span>
            </Link>
          </div>
        </main>
      );
    }
  }

  if (result) {
    return (
      <main className="wrap-wide">
        <div className="surface confirm-card cop-confirm">
          <div className="confirm-tick cop-tick" aria-hidden="true">
            <svg viewBox="0 0 52 52" fill="none">
              <circle className="cop-tick-ring" cx="26" cy="26" r="24" />
              <path className="cop-tick-check" d="M15 27.5l7.5 7.5L37 19" />
            </svg>
          </div>
          <span className="eyebrow">Payment intent created</span>
          <h2 className="h-lg" style={{ margin: '10px 0 8px' }}>
            Almost there.
          </h2>
          <p className="lede cop-confirm-lede">
            In production the {provider} SDK would now collect payment for{' '}
            <strong style={{ color: 'var(--ink)' }}>{money(result.totals.totalCents)}</strong>. The
            order is created by the payment webhook once the provider confirms.
          </p>
          <dl className="cop-confirm-refs">
            <div>
              <dt className="meta">Intent</dt>
              <dd className="font-mono">{result.intentId}</dd>
            </div>
            <div>
              <dt className="meta">Provider ref</dt>
              <dd className="font-mono">{result.providerRef}</dd>
            </div>
          </dl>
          <p className="surface pad meta cop-confirm-note">
            No live payment keys are configured in this environment. Simulate a paid order by
            delivering the provider webhook to{' '}
            <code>/api/v1/webhooks/payments/{provider}</code>.
          </p>
          <div className="row cop-confirm-actions">
            <Link href="/account/orders" className="btn btn-clay">
              View your orders <span className="arr">→</span>
            </Link>
            <Link href="/" className="btn btn-ghost">
              Continue shopping
            </Link>
          </div>
        </div>
      </main>
    );
  }

  const lines = totals?.lines ?? [];
  const itemQtyById = new Map((cart?.items ?? []).map(i => [i.id, i.qty]));

  return (
    <main className="wrap-wide cop">
      <div className="between cop-head">
        <h1 className="h-lg">Checkout</h1>
        <Link href="/cart" className="ucap link-u muted">
          Back to cart
        </Link>
      </div>

      <ol className="co-steps cop-steps" aria-label="Checkout progress">
        <li className="st done">
          <span className="n" aria-hidden="true">
            ✓
          </span>{' '}
          Cart
        </li>
        <li className="ln done" aria-hidden="true" />
        <li className="st on" aria-current="step">
          <span className="n" aria-hidden="true">
            2
          </span>{' '}
          Details
        </li>
        <li className="ln" aria-hidden="true" />
        <li className="st">
          <span className="n" aria-hidden="true">
            3
          </span>{' '}
          Confirmation
        </li>
      </ol>

      <form onSubmit={onSubmit} className="checkout-grid">
        {/* Form side */}
        <div>
          <Reveal y={16}>
            <section className="surface pad co-block cop-card">
              <h3>Shipping address</h3>
              <div className="grid-2">
                <Field
                  label="Full name"
                  value={address.name}
                  onChange={v => set('name', v)}
                  required
                  autoComplete="name"
                />
                <Field
                  label="Phone"
                  value={address.phone}
                  onChange={v => set('phone', v)}
                  autoComplete="tel"
                  inputMode="tel"
                />
                <Field
                  label="Address line 1"
                  value={address.line1}
                  onChange={v => set('line1', v)}
                  required
                  full
                  autoComplete="address-line1"
                />
                <Field
                  label="Address line 2"
                  value={address.line2}
                  onChange={v => set('line2', v)}
                  full
                  autoComplete="address-line2"
                />
                <Field
                  label="City"
                  value={address.city}
                  onChange={v => set('city', v)}
                  required
                  autoComplete="address-level2"
                />
                <Field
                  label="State / Region"
                  value={address.region}
                  onChange={v => set('region', v)}
                  required
                  autoComplete="address-level1"
                />
                <Field
                  label="Postal code"
                  value={address.postal}
                  onChange={v => set('postal', v)}
                  required
                  autoComplete="postal-code"
                  inputMode="numeric"
                />
                <Field
                  label="Country"
                  value={address.country}
                  onChange={v => set('country', v)}
                  required
                  autoComplete="country"
                />
              </div>
            </section>
          </Reveal>

          <Reveal y={16} delay={90}>
            <section className="surface pad co-block cop-card">
              <h3>Payment</h3>
              {(['razorpay', 'stripe'] as Provider[]).map(p => (
                <label key={p} className={`pay-opt${provider === p ? ' on' : ''}`}>
                  <input
                    type="radio"
                    name="provider"
                    value={p}
                    checked={provider === p}
                    onChange={() => setProvider(p)}
                    className="sr-only"
                  />
                  <span className="radio" />
                  <span className="grow">
                    <strong className="cop-pay-name">{p}</strong>
                    <div className="meta">
                      {p === 'razorpay'
                        ? 'Cards, UPI, wallets & net-banking'
                        : 'Card, Apple Pay & Google Pay'}
                    </div>
                  </span>
                </label>
              ))}
              <p className="meta cop-pay-note">
                <Lock aria-hidden size={13} strokeWidth={1.8} /> You&apos;ll be securely redirected
                to complete payment. We never store card details.
              </p>
            </section>
          </Reveal>

          <button
            type="submit"
            className="btn btn-clay btn-lg btn-block cop-submit"
            disabled={submitting}
          >
            {submitting ? 'Processing…' : 'Place order'} <span className="arr">→</span>
          </button>
        </div>

        {/* Summary */}
        <aside className="summary">
          <div className="surface pad cop-summary">
            <h3 className="h-md cop-summary-title">Your order</h3>

            <div className="cop-lines">
              {lines.map(line => {
                const meta = variantMeta[line.variantId];
                const image = meta?.image ?? (meta?.slug ? getProductImage(meta.slug) : null);
                const name = meta?.name ?? `Item ${line.variantId.slice(0, 8)}`;
                const axes = meta?.axes
                  ? Object.values(meta.axes).map(humanizeAxisValue).filter(Boolean)
                  : [];
                const qty = itemQtyById.get(line.itemId) ?? line.qty;
                return (
                  <div key={line.itemId} className="co-line">
                    <span className="cop-line-thumb">
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
                        <span className="ph clean" aria-hidden="true" />
                      )}
                      <span className="cop-line-qty" aria-hidden="true">
                        {qty}
                      </span>
                    </span>
                    <span className="grow cop-line-main">
                      <span className="cop-line-name">{name}</span>
                      {axes.length > 0 ? (
                        <span className="meta">{axes.join(' · ')}</span>
                      ) : null}
                      <span className="sr-only">Quantity {qty}</span>
                    </span>
                    <span className="price cop-line-total">{money(line.lineTotalCents)}</span>
                  </div>
                );
              })}
            </div>

            <div className="cop-sums">
              <div className="sum-line">
                <span>Subtotal</span>
                <span className="price">{money(totals?.subtotalCents ?? 0)}</span>
              </div>
              {totals && totals.discountCents > 0 ? (
                <div className="sum-line">
                  <span>Discount</span>
                  <span className="price cop-good">−{money(totals.discountCents)}</span>
                </div>
              ) : null}
              <div className="sum-line">
                <span>Tax</span>
                <span className="price muted">{money(totals?.taxCents ?? 0)}</span>
              </div>
              <div className="sum-line">
                <span>
                  Shipping
                  {totals?.shippingOption ? ` (${totals.shippingOption.label})` : ''}
                </span>
                <span className="price">
                  {totals && totals.shippingCents === 0 && totals.shippingOption ? (
                    <span className="cop-good">Free</span>
                  ) : (
                    money(totals?.shippingCents ?? 0)
                  )}
                </span>
              </div>
              <div className="sum-line total">
                <span>Total</span>
                <span className="price">{money(totals?.totalCents ?? 0)}</span>
              </div>
            </div>

            <div className="cop-trust">
              <span className="cop-trust-item">
                <ShieldCheck aria-hidden size={15} strokeWidth={1.7} /> Secure, encrypted checkout
              </span>
              <span className="cop-trust-item">
                <Banknote aria-hidden size={15} strokeWidth={1.7} /> Cash on Delivery up to ₹5,000
              </span>
              <span className="cop-trust-item">
                <RotateCcw aria-hidden size={15} strokeWidth={1.7} /> 7-day easy returns
              </span>
            </div>
          </div>
        </aside>
      </form>
    </main>
  );
}

function Field({
  label,
  value,
  onChange,
  required,
  full,
  autoComplete,
  inputMode,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  required?: boolean;
  full?: boolean;
  autoComplete?: string;
  inputMode?: 'tel' | 'numeric';
}) {
  const id = `co-${label.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
  return (
    <div className={`field${full ? ' full' : ''}`}>
      <label htmlFor={id}>
        {label}
        {required ? (
          <span style={{ color: 'var(--clay)' }} aria-hidden="true">
            {' '}
            *
          </span>
        ) : null}
      </label>
      <input
        id={id}
        className="input"
        value={value}
        onChange={e => onChange(e.target.value)}
        required={required}
        {...(autoComplete ? { autoComplete } : {})}
        {...(inputMode ? { inputMode } : {})}
      />
    </div>
  );
}
