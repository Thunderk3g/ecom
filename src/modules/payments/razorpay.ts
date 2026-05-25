import Razorpay from 'razorpay';

import { getEnv } from '@/lib/env';

import type {
  CreateIntentInput,
  CreateIntentResult,
  PaymentProvider,
  ProviderEvent,
  ProviderEventType,
  RefundPaymentResult,
} from './provider';
import { verifyHmacSha256Hex } from './signature';

/**
 * Razorpay adapter (SP-4 task 14).
 *
 * Money model: the public PaymentProvider interface speaks integer cents,
 * but Razorpay accepts paise (smallest INR unit). For INR these are 1:1 —
 * `amountCents` is already the right number. For currencies where "cents"
 * and "smallest unit" diverge the caller is responsible for normalising
 * upstream (we never get cents-for-INR mixed with cents-for-USD in one
 * Razorpay merchant account in practice). The conversion factor is `1`.
 *
 * Webhook verification: Razorpay signs the raw request body with the
 * webhook secret using HMAC-SHA256, hex-encoded, sent in the
 * `x-razorpay-signature` header. We re-compute and `timingSafeEqual` via
 * `signature.ts`.
 */
export class RazorpayProvider implements PaymentProvider {
  readonly name = 'razorpay' as const;

  // Lazy-initialised SDK client + cached env-derived secrets. Constructing
  // the SDK does not hit the network — but reading env at module load time
  // would break tests that don't set Razorpay keys, so we defer until first
  // use of `createIntent` / `cancelIntent`.
  private _client: Razorpay | null = null;
  private _webhookSecret: string | null = null;

  private client(): Razorpay {
    if (this._client) return this._client;
    const env = getEnv();
    if (!env.RAZORPAY_KEY_ID || !env.RAZORPAY_KEY_SECRET) {
      throw new Error(
        'RazorpayProvider: RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET must be set to use the Razorpay payment provider',
      );
    }
    this._client = new Razorpay({
      key_id: env.RAZORPAY_KEY_ID,
      key_secret: env.RAZORPAY_KEY_SECRET,
    });
    return this._client;
  }

  private webhookSecret(): string {
    if (this._webhookSecret) return this._webhookSecret;
    const env = getEnv();
    if (!env.RAZORPAY_WEBHOOK_SECRET) {
      throw new Error(
        'RazorpayProvider: RAZORPAY_WEBHOOK_SECRET must be set to verify Razorpay webhooks',
      );
    }
    this._webhookSecret = env.RAZORPAY_WEBHOOK_SECRET;
    return this._webhookSecret;
  }

  async createIntent(input: CreateIntentInput): Promise<CreateIntentResult> {
    // cents → paise: 1:1 for INR. See class header.
    const amountPaise = input.amountCents;
    // Razorpay's notes are string|number; we only push strings to keep the
    // PaymentProvider contract uniform with Stripe's metadata.
    const notes: Record<string, string> = {
      cartId: input.cartId,
      ...(input.metadata ?? {}),
    };
    // Razorpay `receipt` is the merchant-side idempotency-ish field (per-Order,
    // ≤40 chars). We forward our SP-1 Idempotency-Key when the caller
    // supplies one; otherwise the cartId is a reasonable short token.
    const receipt = (input.idempotencyKey ?? input.cartId).slice(0, 40);
    const order = await this.client().orders.create({
      amount: amountPaise,
      currency: input.currency,
      receipt,
      notes,
    });
    return {
      providerRef: order.id,
      raw: order as unknown as Record<string, unknown>,
    };
  }

  verifyWebhookSignature(rawBody: string, signatureHeader: string): boolean {
    if (!signatureHeader) return false;
    return verifyHmacSha256Hex(this.webhookSecret(), rawBody, signatureHeader);
  }

  parseEvent(payload: Record<string, unknown>): ProviderEvent {
    const eventName = typeof payload['event'] === 'string' ? (payload['event'] as string) : '';
    const providerEventId = typeof payload['id'] === 'string' ? (payload['id'] as string) : '';
    const type = mapRazorpayEventType(eventName);
    const { providerRef, amountCents } = extractRazorpayRef(payload, type);
    return {
      type,
      providerEventId,
      providerRef,
      amountCents,
      raw: payload,
    };
  }

  async cancelIntent(_providerRef: string): Promise<void> {
    // Razorpay orders cannot be cancelled via API — they simply expire if
    // no payment is attached. The reservation release is handled by the
    // checkout module; this is intentionally a no-op so the interface
    // remains uniform with Stripe (where PaymentIntents *can* be cancelled).
    // The parameter is referenced to satisfy linters that flag unused args.
    void _providerRef;
  }

  async refundPayment(
    providerRef: string,
    amountCents: number,
    opts?: { idempotencyKey?: string },
  ): Promise<RefundPaymentResult> {
    // Razorpay refunds are scoped to a payment id (pay_*), not the order id.
    // The caller (refund module) MUST pass the captured payment's
    // payment.id — typically the value stored in `payments.providerRef`.
    // amountCents → paise: 1:1 for INR (see class header).
    const params: Record<string, unknown> = { amount: amountCents };
    if (opts?.idempotencyKey) {
      // Razorpay uses `notes` for free-form metadata; surface the
      // idempotency key there so duplicate retries can be reconciled on
      // the dashboard. The Node SDK does not expose a per-request
      // idempotency header on refunds, so the API is naturally
      // at-most-once per call.
      params['notes'] = { idempotency_key: opts.idempotencyKey };
    }
    const refund = await this.client().payments.refund(providerRef, params);
    return {
      providerRef: refund.id,
      raw: refund as unknown as Record<string, unknown>,
    };
  }
}

function mapRazorpayEventType(event: string): ProviderEventType {
  switch (event) {
    case 'payment.captured':
      return 'payment_succeeded';
    case 'payment.failed':
      return 'payment_failed';
    case 'refund.processed':
      return 'refund_succeeded';
    default:
      return 'other';
  }
}

/**
 * Pull the order_id (our payment_intents.providerRef) and settled amount in
 * paise out of a Razorpay event payload. Razorpay nests the relevant entity
 * under `payload.payment.entity` / `payload.refund.entity` depending on event.
 */
function extractRazorpayRef(
  payload: Record<string, unknown>,
  type: ProviderEventType,
): { providerRef: string; amountCents?: number } {
  const root = payload['payload'];
  if (!isObject(root)) return { providerRef: '' };

  if (type === 'refund_succeeded') {
    const refund = isObject(root['refund']) ? (root['refund']['entity'] as unknown) : undefined;
    if (isObject(refund)) {
      const orderRef = typeof refund['order_id'] === 'string' ? refund['order_id'] : '';
      const amt = typeof refund['amount'] === 'number' ? refund['amount'] : undefined;
      return { providerRef: orderRef, amountCents: amt };
    }
  }

  const payment = isObject(root['payment']) ? (root['payment']['entity'] as unknown) : undefined;
  if (isObject(payment)) {
    const orderRef = typeof payment['order_id'] === 'string' ? payment['order_id'] : '';
    const amt = typeof payment['amount'] === 'number' ? payment['amount'] : undefined;
    return { providerRef: orderRef, amountCents: amt };
  }
  return { providerRef: '' };
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}
