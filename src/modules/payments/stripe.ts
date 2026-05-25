import Stripe from 'stripe';

import { getEnv } from '@/lib/env';

import type {
  CreateIntentInput,
  CreateIntentResult,
  PaymentProvider,
  ProviderEvent,
  ProviderEventType,
  RefundPaymentResult,
} from './provider';

/**
 * Stripe adapter (SP-4 task 14).
 *
 * Money model: Stripe's smallest currency unit IS "cents" for USD/EUR — and
 * also paise for INR — so the PaymentProvider's `amountCents` maps 1:1 to
 * Stripe's `amount` field.
 *
 * Webhook verification: delegated to `stripe.webhooks.constructEvent`, which
 * does an HMAC-SHA256 with constant-time comparison internally and also
 * validates the timestamp tolerance (5 min default) to defeat replay.
 */
export class StripeProvider implements PaymentProvider {
  readonly name = 'stripe' as const;

  private _client: Stripe | null = null;
  private _webhookSecret: string | null = null;

  private client(): Stripe {
    if (this._client) return this._client;
    const env = getEnv();
    if (!env.STRIPE_SECRET_KEY) {
      throw new Error(
        'StripeProvider: STRIPE_SECRET_KEY must be set to use the Stripe payment provider',
      );
    }
    // Stripe's SDK reads its own pinned API version at runtime; we let it
    // pick the default to avoid version-drift typecheck pain across SDK
    // upgrades. Override per-deployment by setting STRIPE_API_VERSION if a
    // future plan requires pinning.
    this._client = new Stripe(env.STRIPE_SECRET_KEY);
    return this._client;
  }

  private webhookSecret(): string {
    if (this._webhookSecret) return this._webhookSecret;
    const env = getEnv();
    if (!env.STRIPE_WEBHOOK_SECRET) {
      throw new Error(
        'StripeProvider: STRIPE_WEBHOOK_SECRET must be set to verify Stripe webhooks',
      );
    }
    this._webhookSecret = env.STRIPE_WEBHOOK_SECRET;
    return this._webhookSecret;
  }

  async createIntent(input: CreateIntentInput): Promise<CreateIntentResult> {
    const metadata: Record<string, string> = {
      cartId: input.cartId,
      ...(input.metadata ?? {}),
    };
    const params: Stripe.PaymentIntentCreateParams = {
      amount: input.amountCents,
      currency: input.currency.toLowerCase(),
      metadata,
      // Modern Stripe Elements / Payment Element flow — let Stripe pick
      // methods enabled on the account dashboard.
      automatic_payment_methods: { enabled: true },
    };
    const options: Stripe.RequestOptions | undefined = input.idempotencyKey
      ? { idempotencyKey: input.idempotencyKey }
      : undefined;
    const intent = options
      ? await this.client().paymentIntents.create(params, options)
      : await this.client().paymentIntents.create(params);
    return {
      providerRef: intent.id,
      // client_secret can be null in rare async-confirm flows; coalesce to
      // undefined so the persisted payment_intents.client_secret column
      // stays NULL rather than the literal string "null".
      clientSecret: intent.client_secret ?? undefined,
      raw: intent as unknown as Record<string, unknown>,
    };
  }

  verifyWebhookSignature(rawBody: string, signatureHeader: string): boolean {
    if (!signatureHeader) return false;
    try {
      // constructEvent throws on bad signature / stale timestamp; if it
      // returns we treat verification as success. The Event object itself
      // is re-derived in parseEvent via the same raw JSON to keep this
      // method side-effect-free.
      this.client().webhooks.constructEvent(rawBody, signatureHeader, this.webhookSecret());
      return true;
    } catch {
      return false;
    }
  }

  parseEvent(payload: Record<string, unknown>): ProviderEvent {
    const eventName = typeof payload['type'] === 'string' ? (payload['type'] as string) : '';
    const providerEventId = typeof payload['id'] === 'string' ? (payload['id'] as string) : '';
    const type = mapStripeEventType(eventName);
    const { providerRef, amountCents } = extractStripeRef(payload, type);
    return {
      type,
      providerEventId,
      providerRef,
      amountCents,
      raw: payload,
    };
  }

  async cancelIntent(providerRef: string): Promise<void> {
    // Best-effort: Stripe rejects cancel on already-succeeded intents with
    // 400. We swallow those — the caller (checkout module) treats this as
    // advisory cleanup, not a correctness guarantee.
    try {
      await this.client().paymentIntents.cancel(providerRef);
    } catch (err) {
      if (err instanceof Stripe.errors.StripeError && err.statusCode === 400) {
        return;
      }
      throw err;
    }
  }

  async refundPayment(
    providerRef: string,
    amountCents: number,
    opts?: { idempotencyKey?: string },
  ): Promise<RefundPaymentResult> {
    // Stripe's refund endpoint accepts either `payment_intent` or `charge`.
    // We pass the PaymentIntent id (our payments.providerRef when the
    // intent was the source of truth). amountCents maps 1:1 to Stripe's
    // smallest currency unit.
    const params: Stripe.RefundCreateParams = {
      payment_intent: providerRef,
      amount: amountCents,
    };
    const requestOptions: Stripe.RequestOptions | undefined = opts?.idempotencyKey
      ? { idempotencyKey: opts.idempotencyKey }
      : undefined;
    const refund = requestOptions
      ? await this.client().refunds.create(params, requestOptions)
      : await this.client().refunds.create(params);
    return {
      providerRef: refund.id,
      raw: refund as unknown as Record<string, unknown>,
    };
  }
}

function mapStripeEventType(event: string): ProviderEventType {
  switch (event) {
    case 'payment_intent.succeeded':
      return 'payment_succeeded';
    case 'payment_intent.payment_failed':
      return 'payment_failed';
    case 'charge.refunded':
      return 'refund_succeeded';
    default:
      return 'other';
  }
}

/**
 * Pull the PaymentIntent id (our payment_intents.providerRef) and amount
 * out of a Stripe event. Stripe wraps the entity in `data.object`; for a
 * `charge.refunded` event that object is a Charge and the intent id lives
 * on `payment_intent`.
 */
function extractStripeRef(
  payload: Record<string, unknown>,
  type: ProviderEventType,
): { providerRef: string; amountCents?: number } {
  const data = payload['data'];
  if (!isObject(data)) return { providerRef: '' };
  const obj = data['object'];
  if (!isObject(obj)) return { providerRef: '' };

  if (type === 'refund_succeeded') {
    const pi = typeof obj['payment_intent'] === 'string' ? obj['payment_intent'] : '';
    const refunded = typeof obj['amount_refunded'] === 'number' ? obj['amount_refunded'] : undefined;
    return { providerRef: pi, amountCents: refunded };
  }

  // payment_intent.succeeded / payment_intent.payment_failed / other → object
  // is the PaymentIntent itself.
  const id = typeof obj['id'] === 'string' ? obj['id'] : '';
  const amountReceived =
    typeof obj['amount_received'] === 'number'
      ? obj['amount_received']
      : typeof obj['amount'] === 'number'
        ? obj['amount']
        : undefined;
  return { providerRef: id, amountCents: amountReceived };
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}
