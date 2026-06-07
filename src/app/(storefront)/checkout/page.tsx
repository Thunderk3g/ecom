'use client';

import Link from 'next/link';
import { useState, type FormEvent } from 'react';
import { toast } from 'sonner';
import { useCart } from '@/components/storefront/cart-context';
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
 */
export default function CheckoutPage() {
  const { cart, totals, ready } = useCart();
  const [address, setAddress] = useState<Address>(EMPTY_ADDRESS);
  const [provider, setProvider] = useState<Provider>('razorpay');
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<StartResult | null>(null);

  function set<K extends keyof Address>(key: K, value: string): void {
    setAddress(a => ({ ...a, [key]: value }));
  }

  function money(cents: number): string {
    try {
      return new Intl.NumberFormat(undefined, {
        style: 'currency',
        currency: cart?.currency ?? 'INR',
      }).format(cents / 100);
    } catch {
      return (cents / 100).toFixed(2);
    }
  }

  async function onSubmit(e: FormEvent<HTMLFormElement>): Promise<void> {
    e.preventDefault();
    if (!cart) {
      toast.error('Your cart is empty');
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
        toast.error('Could not save address');
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
        toast.error(body.detail ?? 'Checkout could not be started');
        return;
      }
      const json = (await startRes.json()) as { data: StartResult };
      setResult(json.data);
      toast.success('Payment intent created');
    } finally {
      setSubmitting(false);
    }
  }

  if (!ready) {
    return (
      <main className="wrap-wide">
        <div className="section" style={{ textAlign: 'center', color: 'var(--ink-3)' }}>
          Loading…
        </div>
      </main>
    );
  }

  if (!cart || (totals?.lines.length ?? 0) === 0) {
    return (
      <main className="wrap-wide">
        <div className="section" style={{ textAlign: 'center' }}>
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

  if (result) {
    return (
      <main className="wrap-wide">
        <div
          className="surface confirm-card"
          style={{ maxWidth: 620, margin: '20px auto 60px' }}
        >
          <div className="confirm-tick">✓</div>
          <span className="eyebrow">Payment intent created</span>
          <h2 className="h-lg" style={{ margin: '10px 0 8px' }}>
            Almost there.
          </h2>
          <p className="lede" style={{ maxWidth: '46ch', margin: '0 auto 6px' }}>
            In production the {provider} SDK would now collect payment for{' '}
            <strong style={{ color: 'var(--ink)' }}>{money(result.totals.totalCents)}</strong>. The
            order is created by the payment webhook once the provider confirms.
          </p>
          <dl
            className="row"
            style={{
              justifyContent: 'center',
              gap: 24,
              marginTop: 18,
              fontSize: 13,
            }}
          >
            <div>
              <dt className="meta">Intent</dt>
              <dd className="font-mono" style={{ fontSize: 12 }}>
                {result.intentId}
              </dd>
            </div>
            <div>
              <dt className="meta">Provider ref</dt>
              <dd className="font-mono" style={{ fontSize: 12 }}>
                {result.providerRef}
              </dd>
            </div>
          </dl>
          <p
            className="surface pad meta"
            style={{ background: 'var(--paper-2)', margin: '20px auto 0', maxWidth: '52ch' }}
          >
            No live payment keys are configured in this environment. Simulate a paid order by
            delivering the provider webhook to{' '}
            <code>/api/v1/webhooks/payments/{provider}</code>.
          </p>
          <div className="row" style={{ justifyContent: 'center', gap: 12, marginTop: 26 }}>
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

  return (
    <main className="wrap-wide">
      <div className="between" style={{ paddingTop: 24, marginBottom: 4 }}>
        <h1 className="h-lg">Checkout</h1>
        <Link href="/cart" className="ucap link-u muted">
          Back to cart
        </Link>
      </div>

      <div className="co-steps" style={{ maxWidth: 520 }}>
        <span className="st done">
          <span className="n">✓</span> Cart
        </span>
        <span className="ln" />
        <span className="st on">
          <span className="n">2</span> Details
        </span>
        <span className="ln" />
        <span className="st">
          <span className="n">3</span> Confirmation
        </span>
      </div>

      <form onSubmit={onSubmit} className="checkout-grid">
        {/* Form side */}
        <div>
          <div className="co-block">
            <h3>Shipping address</h3>
            <div className="grid-2">
              <Field label="Full name" value={address.name} onChange={v => set('name', v)} required />
              <Field label="Phone" value={address.phone} onChange={v => set('phone', v)} />
              <Field
                label="Address line 1"
                value={address.line1}
                onChange={v => set('line1', v)}
                required
                full
              />
              <Field
                label="Address line 2"
                value={address.line2}
                onChange={v => set('line2', v)}
                full
              />
              <Field label="City" value={address.city} onChange={v => set('city', v)} required />
              <Field
                label="State / Region"
                value={address.region}
                onChange={v => set('region', v)}
                required
              />
              <Field
                label="Postal code"
                value={address.postal}
                onChange={v => set('postal', v)}
                required
              />
              <Field
                label="Country"
                value={address.country}
                onChange={v => set('country', v)}
                required
              />
            </div>
          </div>

          <div className="co-block">
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
                  <strong style={{ fontSize: 14, textTransform: 'capitalize' }}>{p}</strong>
                  <div className="meta">
                    {p === 'razorpay'
                      ? 'Cards, UPI, wallets & net-banking'
                      : 'Card, Apple Pay & Google Pay'}
                  </div>
                </span>
              </label>
            ))}
            <p className="meta" style={{ marginTop: 8 }}>
              🔒 You&apos;ll be securely redirected to complete payment. We never store card details.
            </p>
          </div>

          <button type="submit" className="btn btn-clay btn-lg btn-block" disabled={submitting}>
            {submitting ? 'Processing…' : 'Place order'} <span className="arr">→</span>
          </button>
        </div>

        {/* Summary */}
        <aside className="summary">
          <div className="surface pad">
            <h3 className="h-md" style={{ fontFamily: 'var(--serif)', marginBottom: 14 }}>
              Your order
            </h3>
            <div style={{ paddingTop: 14 }}>
              <div className="sum-line">
                <span>Subtotal</span>
                <span>{money(totals?.subtotalCents ?? 0)}</span>
              </div>
              {totals && totals.discountCents > 0 ? (
                <div className="sum-line">
                  <span>Discount</span>
                  <span style={{ color: 'var(--good)' }}>−{money(totals.discountCents)}</span>
                </div>
              ) : null}
              <div className="sum-line">
                <span>Tax</span>
                <span>{money(totals?.taxCents ?? 0)}</span>
              </div>
              <div className="sum-line">
                <span>Shipping</span>
                <span>{money(totals?.shippingCents ?? 0)}</span>
              </div>
              <div className="sum-line total">
                <span>Total</span>
                <span>{money(totals?.totalCents ?? 0)}</span>
              </div>
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
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  required?: boolean;
  full?: boolean;
}) {
  return (
    <div className={`field${full ? ' full' : ''}`}>
      <label>
        {label}
        {required ? <span style={{ color: 'var(--clay)' }}> *</span> : null}
      </label>
      <input
        className="input"
        value={value}
        onChange={e => onChange(e.target.value)}
        required={required}
      />
    </div>
  );
}
