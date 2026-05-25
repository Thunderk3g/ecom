/**
 * Shared helpers for SP-4 storefront checkout routes (Stream E task 16).
 *
 * Checkout reuses the storefront context pipeline from `../cart/_lib.ts`
 * (same tenant / cookie / CSRF / Idempotency-Key gate). The only addition is
 * `mapCheckoutError`, which translates the typed errors from
 * `src/modules/checkout/errors.ts` into RFC 7807 responses.
 *
 *   EmptyCartError               → 409 cart-empty
 *   MissingShippingAddressError  → 409 missing-shipping-address
 *   IntentNotFoundError          → 404 intent-not-found
 *   CheckoutNotFoundError        → 404 checkout-not-found
 *   ProviderMismatchError        → 409 provider-mismatch
 *   AmountMismatchError          → 409 amount-mismatch
 *   OrderAlreadyExistsError      → 409 order-already-exists
 *
 * Unknown errors fall through to an opaque 500 — never leak the message.
 */

import { NextResponse } from 'next/server';
import { problem } from '@/lib/errors';
import {
  AmountMismatchError,
  CheckoutError,
  CheckoutNotFoundError,
  EmptyCartError,
  IntentNotFoundError,
  MissingShippingAddressError,
  OrderAlreadyExistsError,
  ProviderMismatchError,
} from '@/modules/checkout/errors';

export function mapCheckoutError(err: unknown): NextResponse {
  if (err instanceof EmptyCartError) {
    return problem(409, 'cart-empty', err.message, []);
  }
  if (err instanceof MissingShippingAddressError) {
    return problem(409, 'missing-shipping-address', err.message, [
      { path: ['shippingAddress'], message: 'required' },
    ]);
  }
  if (err instanceof IntentNotFoundError) {
    return problem(404, 'intent-not-found', err.message, []);
  }
  if (err instanceof CheckoutNotFoundError) {
    return problem(404, 'checkout-not-found', err.message, []);
  }
  if (err instanceof ProviderMismatchError) {
    return problem(409, 'provider-mismatch', err.message, [
      { path: ['provider'], message: `expected ${err.expected}` },
    ]);
  }
  if (err instanceof AmountMismatchError) {
    return problem(409, 'amount-mismatch', err.message, [
      { path: ['amount'], message: `expected ${err.intentAmountCents} cents` },
    ]);
  }
  if (err instanceof OrderAlreadyExistsError) {
    return problem(409, 'order-already-exists', err.message, [
      { path: ['orderId'], message: err.orderId },
    ]);
  }
  if (err instanceof CheckoutError) {
    return problem(400, 'checkout-error', err.message, []);
  }
  return problem(500, 'internal-error', 'Internal server error', []);
}
