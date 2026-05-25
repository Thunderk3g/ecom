/**
 * PaymentProvider abstraction (SP-4 task 14).
 *
 * Two concrete adapters live alongside this file:
 *   - `razorpay.ts` — Razorpay Orders + webhook HMAC verification (INR default)
 *   - `stripe.ts`   — Stripe PaymentIntents + webhook constructEvent
 *
 * The interface intentionally talks in integer cents and provider-agnostic
 * event types. Adapters convert to the provider's native unit (paise/cents)
 * and normalise event names.
 */

export type ProviderName = 'razorpay' | 'stripe';

export type CreateIntentInput = {
  amountCents: number;
  currency: string;
  cartId: string;
  /** Free-form provider metadata (e.g. storeId). Must be strings per Stripe. */
  metadata?: Record<string, string>;
  /** Idempotency key passed through to the provider. Razorpay uses `receipt`. */
  idempotencyKey?: string;
};

export type CreateIntentResult = {
  /** Provider-side identifier — Razorpay order_id or Stripe payment_intent id. */
  providerRef: string;
  /** Stripe-only client_secret used by stripe.js to confirm on the client. */
  clientSecret?: string;
  /** Raw provider response, persisted on `payment_intents.raw` for debugging. */
  raw: Record<string, unknown>;
};

/**
 * Normalised webhook event types. Provider-native event names are mapped into
 * one of these via `parseEvent`; anything we don't act on becomes 'other'.
 */
export type ProviderEventType =
  | 'payment_succeeded'
  | 'payment_failed'
  | 'refund_succeeded'
  | 'other';

export type ProviderEvent = {
  type: ProviderEventType;
  /** Stable provider-side event id — used as the natural idempotency key. */
  providerEventId: string;
  /** Reference back to the intent / order this event belongs to. */
  providerRef: string;
  /** Settled amount in integer cents, if the event carries one. */
  amountCents?: number;
  /** Raw event payload for audit + payment_events.payload column. */
  raw: Record<string, unknown>;
};

export type RefundPaymentResult = {
  /** Provider-side refund id (Razorpay rfnd_*, Stripe re_*). */
  providerRef: string;
  /** Raw provider response — persisted on `refunds.raw` for audit. */
  raw: Record<string, unknown>;
};

export interface PaymentProvider {
  readonly name: ProviderName;
  createIntent(input: CreateIntentInput): Promise<CreateIntentResult>;
  /**
   * Verify a webhook signature against the raw (unparsed) request body and
   * provider-specific header. MUST use constant-time comparison
   * (`crypto.timingSafeEqual` or `stripe.webhooks.constructEvent`).
   */
  verifyWebhookSignature(rawBody: string, signatureHeader: string): boolean;
  parseEvent(payload: Record<string, unknown>): ProviderEvent;
  cancelIntent(providerRef: string): Promise<void>;
  /**
   * Issue a refund against a captured payment. `providerRef` is the captured
   * payment's provider id — Razorpay `pay_*` or Stripe `pi_*` / `ch_*`. The
   * idempotencyKey is the refund row's id so safe to retry.
   */
  refundPayment(
    providerRef: string,
    amountCents: number,
    opts?: { idempotencyKey?: string },
  ): Promise<RefundPaymentResult>;
}

/**
 * Factory. Lazy: the matching adapter file is imported on first call only
 * so a deployment that uses Razorpay never has to load the Stripe SDK
 * (and vice versa). The adapter's constructor is also lazy about reading
 * env vars — it throws on first use if its keys are missing.
 */
export async function getPaymentProvider(name: ProviderName): Promise<PaymentProvider> {
  if (name === 'razorpay') {
    const { RazorpayProvider } = await import('./razorpay');
    return new RazorpayProvider();
  }
  if (name === 'stripe') {
    const { StripeProvider } = await import('./stripe');
    return new StripeProvider();
  }
  // Exhaustiveness check — TS will flag a missing branch if ProviderName grows.
  const exhaustive: never = name;
  throw new Error(`Unknown payment provider: ${String(exhaustive)}`);
}
