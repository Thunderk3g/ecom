/**
 * Fake payment provider implementation used by SP-4 checkout + webhook tests.
 *
 * Why a fake? The real RazorpayProvider / StripeProvider hit live HTTPS APIs
 * to create orders or PaymentIntents. We don't want tests to depend on
 * network or test keys. The PaymentProvider interface is small (createIntent,
 * verifyWebhookSignature, parseEvent, cancelIntent) so a deterministic
 * in-process implementation per provider name is straightforward.
 *
 * Determinism contract:
 *   - `createIntent` returns a stable providerRef of the form
 *     `<name>_<cartId>_<amountCents>` so repeated calls for the same cart
 *     produce the same ref. This lets the webhook tests sign a payload with
 *     a known providerRef and have it match the persisted intent row.
 *   - For Stripe, `clientSecret` is `<providerRef>_secret`.
 *   - `parseEvent` mirrors the real adapters' shape so the route handler's
 *     dispatch logic (which reads `event.providerRef` etc.) sees the same
 *     payload contract.
 *   - `verifyWebhookSignature` computes its OWN HMAC-SHA256 over the raw
 *     body with the per-fake `webhookSecret` — both providers use the same
 *     scheme here (the route picks the header name and the fake doesn't
 *     care which header the test put it in). This sidesteps Stripe's
 *     timestamp-tolerance verification, which would require importing the
 *     Stripe SDK just to sign.
 *
 * Wiring into the system under test:
 *   - The shipped `getPaymentProvider` factory `await import()`s the real
 *     adapter. To inject the fake we monkey-patch the `getPaymentProvider`
 *     export on the module object via Vitest's `vi.spyOn` — the test sets
 *     up an `installFakePaymentProviders()` once in `beforeAll` and reverts
 *     in `afterAll`. This is the lightest-touch way to avoid editing
 *     `src/modules/payments/provider.ts` solely for test plumbing.
 */

import { vi } from 'vitest';
import { createHmac } from 'node:crypto';

import * as providerModule from '@/modules/payments/provider';
import type {
  CreateIntentInput,
  CreateIntentResult,
  PaymentProvider,
  ProviderEvent,
  ProviderEventType,
  ProviderName,
  RefundPaymentResult,
} from '@/modules/payments/provider';

/**
 * Default test secrets — the env var fallback path inside the real
 * providers reads these names but the fake honours its own constructor arg
 * regardless. Tests can override per provider if they need to.
 */
export const FAKE_RAZORPAY_SECRET = 'fake_razorpay_webhook_secret_test_only';
export const FAKE_STRIPE_SECRET = 'fake_stripe_webhook_secret_test_only';

export class FakePaymentProvider implements PaymentProvider {
  public readonly name: ProviderName;
  public readonly webhookSecret: string;
  /** Tracks createIntent calls so tests can verify idempotency / counts. */
  public readonly createCalls: CreateIntentInput[] = [];
  /** Tracks cancelIntent calls. */
  public readonly cancelCalls: string[] = [];
  /** Tracks refundPayment calls so tests can assert per-refund behaviour. */
  public readonly refundCalls: Array<{
    providerRef: string;
    amountCents: number;
    idempotencyKey?: string;
  }> = [];

  constructor(name: ProviderName, webhookSecret: string) {
    this.name = name;
    this.webhookSecret = webhookSecret;
  }

  async createIntent(input: CreateIntentInput): Promise<CreateIntentResult> {
    this.createCalls.push(input);
    // Stable provider ref so a webhook test can sign a payload whose
    // providerRef points at a known intent without an extra round-trip.
    const providerRef = `${this.name}_${input.cartId}_${input.amountCents}`;
    const result: CreateIntentResult = {
      providerRef,
      raw: {
        id: providerRef,
        amount: input.amountCents,
        currency: input.currency,
        cartId: input.cartId,
        metadata: input.metadata ?? {},
      },
    };
    if (this.name === 'stripe') {
      result.clientSecret = `${providerRef}_secret`;
    }
    return result;
  }

  verifyWebhookSignature(rawBody: string, signatureHeader: string): boolean {
    if (!signatureHeader) return false;
    const expected = createHmac('sha256', this.webhookSecret)
      .update(rawBody, 'utf8')
      .digest('hex');
    // Constant-time compare via string-equal; for tests timing leaks don't matter.
    if (expected.length !== signatureHeader.length) return false;
    let diff = 0;
    for (let i = 0; i < expected.length; i++) {
      diff |= expected.charCodeAt(i) ^ signatureHeader.charCodeAt(i);
    }
    return diff === 0;
  }

  parseEvent(payload: Record<string, unknown>): ProviderEvent {
    const eventType = typeof payload['type'] === 'string' ? (payload['type'] as string) : '';
    const type = mapFakeEventType(eventType);
    const providerEventId = typeof payload['id'] === 'string' ? (payload['id'] as string) : '';
    const providerRef =
      typeof payload['providerRef'] === 'string' ? (payload['providerRef'] as string) : '';
    const amt = payload['amountCents'];
    const result: ProviderEvent = {
      type,
      providerEventId,
      providerRef,
      raw: payload,
    };
    if (typeof amt === 'number') result.amountCents = amt;
    return result;
  }

  async cancelIntent(providerRef: string): Promise<void> {
    this.cancelCalls.push(providerRef);
  }

  async refundPayment(
    providerRef: string,
    amountCents: number,
    opts?: { idempotencyKey?: string },
  ): Promise<RefundPaymentResult> {
    const call: { providerRef: string; amountCents: number; idempotencyKey?: string } = {
      providerRef,
      amountCents,
    };
    if (opts?.idempotencyKey !== undefined) {
      call.idempotencyKey = opts.idempotencyKey;
    }
    this.refundCalls.push(call);
    // Stable deterministic refund id so tests can assert on it without
    // capturing the exact instant.
    const refundRef = `${this.name}_refund_${providerRef}_${amountCents}_${this.refundCalls.length}`;
    return {
      providerRef: refundRef,
      raw: { id: refundRef, providerRef, amountCents, fake: true },
    };
  }
}

function mapFakeEventType(s: string): ProviderEventType {
  switch (s) {
    case 'payment_succeeded':
    case 'payment.captured':
    case 'payment_intent.succeeded':
      return 'payment_succeeded';
    case 'payment_failed':
    case 'payment.failed':
    case 'payment_intent.payment_failed':
      return 'payment_failed';
    case 'refund_succeeded':
      return 'refund_succeeded';
    default:
      return 'other';
  }
}

/**
 * Produce the signature header value a test should send for the given raw
 * webhook body + secret. The fake's verifyWebhookSignature checks for an
 * HMAC-SHA256 hex string — provider-agnostic at the test layer.
 */
export function signFakeWebhook(rawBody: string, secret: string): string {
  return createHmac('sha256', secret).update(rawBody, 'utf8').digest('hex');
}

/**
 * Build a fake webhook payload in the canonical shape the production route
 * persists onto payment_events.payload: `{ providerRef, providerEventId,
 * type, amountCents?, raw }`. Tests call this so `applyPaymentEvent` can
 * read providerRef back the same way it does for real providers.
 */
export function buildFakeWebhookPayload(opts: {
  providerRef: string;
  providerEventId: string;
  type: 'payment_succeeded' | 'payment_failed' | 'refund_succeeded';
  amountCents?: number;
}): Record<string, unknown> {
  return {
    id: opts.providerEventId,
    type: opts.type,
    providerRef: opts.providerRef,
    ...(opts.amountCents !== undefined ? { amountCents: opts.amountCents } : {}),
    raw: { fake: true },
  };
}

type Installed = {
  fakeRazorpay: FakePaymentProvider;
  fakeStripe: FakePaymentProvider;
  uninstall: () => void;
};

/**
 * Monkey-patch the `getPaymentProvider` factory so production code that
 * `await import()`s a real adapter receives our fake instead. Restore
 * the original on teardown via the returned `uninstall()` callback.
 *
 * The same fake instance is returned across calls for a given provider
 * name within a test run — that's what makes idempotency assertions work
 * (e.g. counting `createCalls`).
 */
export function installFakePaymentProviders(opts?: {
  razorpaySecret?: string;
  stripeSecret?: string;
}): Installed {
  const razorpaySecret = opts?.razorpaySecret ?? FAKE_RAZORPAY_SECRET;
  const stripeSecret = opts?.stripeSecret ?? FAKE_STRIPE_SECRET;
  const fakeRazorpay = new FakePaymentProvider('razorpay', razorpaySecret);
  const fakeStripe = new FakePaymentProvider('stripe', stripeSecret);

  const spy = vi.spyOn(providerModule, 'getPaymentProvider').mockImplementation(
    async (name: ProviderName): Promise<PaymentProvider> => {
      if (name === 'razorpay') return fakeRazorpay;
      if (name === 'stripe') return fakeStripe;
      throw new Error(`unknown provider in test: ${String(name)}`);
    },
  );

  return {
    fakeRazorpay,
    fakeStripe,
    uninstall: () => {
      spy.mockRestore();
    },
  };
}
