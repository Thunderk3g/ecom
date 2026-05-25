/**
 * Typed checkout-domain error classes. HTTP route handlers (Streams E/F) map
 * these to RFC 7807 problem+json responses. Module services throw these
 * directly — never construct HTTP responses inline.
 *
 * EmptyCartError and MissingShippingAddressError are re-exported from the cart
 * module so callers can `import { ... } from '@/modules/checkout/errors'` and
 * get the full set in one place.
 */

export {
  EmptyCartError,
  MissingShippingAddressError,
} from '@/modules/cart/errors';

export class CheckoutError extends Error {
  constructor(message: string, public override readonly cause?: unknown) {
    super(message);
    this.name = new.target.name;
  }
}

/** A cart id, intent id, or order ref was not visible in the current tenant. */
export class CheckoutNotFoundError extends CheckoutError {
  constructor(public readonly identifier: string) {
    super(`Checkout target not found: ${identifier}`);
  }
}

/** A payment_intents row was not visible in the current tenant. */
export class IntentNotFoundError extends CheckoutError {
  constructor(public readonly intentId: string) {
    super(`Payment intent not found: ${intentId}`);
  }
}

/**
 * Caller asked to start checkout with a different provider than the intent
 * already attached to this cart. The flow must cancel the prior intent or
 * release reservations before switching providers — never two parallel intents.
 */
export class ProviderMismatchError extends CheckoutError {
  constructor(
    public readonly expected: string,
    public readonly received: string,
  ) {
    super(`Provider mismatch: expected ${expected}, received ${received}`);
  }
}

/**
 * Re-priced totals at order-creation time do not match the intent's recorded
 * `amountCents` within the rounding tolerance. The webhook handler treats this
 * as a hard failure (do not place the order — caller must investigate).
 */
export class AmountMismatchError extends CheckoutError {
  constructor(
    public readonly intentAmountCents: number,
    public readonly recomputedAmountCents: number,
  ) {
    super(
      `Amount mismatch: intent=${intentAmountCents}, recomputed=${recomputedAmountCents}`,
    );
  }
}

/**
 * A webhook (or retry) tried to create an order for a cart that has already
 * produced one. Detected when a row exists in `orders` referencing the same
 * intentId via the linked payment, or when the cart no longer exists because
 * createOrderFromCart already ran in a prior delivery.
 */
export class OrderAlreadyExistsError extends CheckoutError {
  public readonly orderId: string;
  constructor(orderId: string) {
    super(`Order already exists: ${orderId}`);
    this.orderId = orderId;
  }
}
