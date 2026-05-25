/**
 * Typed errors for the order lifecycle / fulfillment / refund domain. HTTP
 * route handlers (Streams E/F) translate these to RFC 7807 problem+json. The
 * module services throw them directly — never construct HTTP responses inline.
 *
 * Naming mirrors `src/modules/checkout/errors.ts`. The lifecycle module also
 * has a defence-in-depth DB trigger (`orders_status_transition_check`); the
 * TS side throws `InvalidOrderTransitionError` first so callers see a typed
 * error rather than a raw `pg` exception when they try a forbidden hop.
 */

export class OrderDomainError extends Error {
  constructor(message: string, public override readonly cause?: unknown) {
    super(message);
    this.name = new.target.name;
  }
}

/** Order id not visible in the current tenant. */
export class OrderNotFoundError extends OrderDomainError {
  constructor(public readonly identifier: string) {
    super(`Order not found: ${identifier}`);
  }
}

/** Caller asked for a status transition that is not in `TRANSITIONS`. */
export class InvalidOrderTransitionError extends OrderDomainError {
  constructor(
    public readonly from: string,
    public readonly to: string,
  ) {
    super(`Invalid order status transition: ${from} -> ${to}`);
  }
}

/**
 * Fulfillment line qty exceeds the unfulfilled remainder for the underlying
 * order_item (ordered qty minus already-fulfilled qty across prior shipments).
 */
export class FulfillmentItemQtyExceededError extends OrderDomainError {
  constructor(
    public readonly orderItemId: string,
    public readonly requestedQty: number,
    public readonly remainingQty: number,
  ) {
    super(
      `Fulfillment qty exceeds remaining for order_item=${orderItemId}: requested=${requestedQty}, remaining=${remainingQty}`,
    );
  }
}

/**
 * Sum of refund amounts (across pending + succeeded refunds plus the new one)
 * exceeds the order's paid total.
 */
export class RefundAmountExceededError extends OrderDomainError {
  constructor(
    public readonly orderId: string,
    public readonly requestedCents: number,
    public readonly availableCents: number,
  ) {
    super(
      `Refund amount exceeds available for order=${orderId}: requested=${requestedCents}, available=${availableCents}`,
    );
  }
}

/**
 * Provider refund call returned an error after the refund row was persisted as
 * 'pending'. A follow-up tx flips the row to 'failed' before the error is
 * surfaced so the admin UI can show what happened.
 */
export class RefundFailedError extends OrderDomainError {
  constructor(
    public readonly refundId: string,
    cause: unknown,
  ) {
    super(`Refund failed at provider: refund=${refundId}`, cause);
  }
}

/**
 * Order is already fully fulfilled — every order_item.qty is covered by prior
 * fulfillment_items. Callers should not attempt another fulfillment.
 */
export class AlreadyFulfilledError extends OrderDomainError {
  constructor(public readonly orderId: string) {
    super(`Order already fully fulfilled: ${orderId}`);
  }
}
