/**
 * Typed cart-domain error classes. HTTP route handlers (Stream E) map these to
 * RFC 7807 problem+json responses via `problem()` in `src/lib/errors.ts`.
 *
 * Module services throw these directly — never construct HTTP responses inline.
 */

export class CartError extends Error {
  constructor(message: string, public override readonly cause?: unknown) {
    super(message);
    this.name = new.target.name;
  }
}

export class CartNotFoundError extends CartError {
  constructor(public readonly identifier: string) {
    super(`Cart not found: ${identifier}`);
  }
}

export class CartItemNotFoundError extends CartError {
  constructor(public readonly identifier: string) {
    super(`Cart item not found: ${identifier}`);
  }
}

export class VariantNotAvailableError extends CartError {
  constructor(public readonly variantId: string, public readonly reason?: string) {
    super(
      `Variant not available: ${variantId}${reason ? ` (${reason})` : ''}`,
    );
  }
}

export class InvalidCouponError extends CartError {
  constructor(public readonly code: string) {
    super(`Invalid coupon code: ${code}`);
  }
}

export class CouponExpiredError extends CartError {
  constructor(public readonly code: string) {
    super(`Coupon expired: ${code}`);
  }
}

export class CouponUsageExhaustedError extends CartError {
  constructor(public readonly code: string) {
    super(`Coupon usage exhausted: ${code}`);
  }
}

export class EmptyCartError extends CartError {
  constructor() {
    super('Cart is empty');
  }
}

export class MissingShippingAddressError extends CartError {
  constructor() {
    super('Cart is missing a shipping address');
  }
}
