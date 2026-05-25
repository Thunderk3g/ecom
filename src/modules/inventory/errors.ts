/**
 * Named error classes for the inventory module.
 *
 * These are domain errors thrown by module-service code (availability, reservations,
 * movements). HTTP route handlers (Streams D/E) catch these and translate to RFC 7807
 * problem responses.
 */

export class InventoryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

/** Reservation request asked for more stock than is currently available. */
export class InsufficientStockError extends InventoryError {
  public readonly variantId: string;
  public readonly locationId: string;
  public readonly requested: number;
  public readonly available: number;

  constructor(variantId: string, locationId: string, requested: number, available: number) {
    super(
      `Insufficient stock for variant ${variantId} at location ${locationId}: requested ${requested}, available ${available}`,
    );
    this.variantId = variantId;
    this.locationId = locationId;
    this.requested = requested;
    this.available = available;
  }
}

/** Reservation exists but is not in 'active' state — cannot release/commit. */
export class ReservationNotActiveError extends InventoryError {
  public readonly reservationId: string;
  public readonly status: string;

  constructor(reservationId: string, status: string) {
    super(`Reservation ${reservationId} is not active (status='${status}')`);
    this.reservationId = reservationId;
    this.status = status;
  }
}

/** Reservation id was not found in the current tenant. */
export class ReservationNotFoundError extends InventoryError {
  public readonly reservationId: string;

  constructor(reservationId: string) {
    super(`Reservation ${reservationId} not found`);
    this.reservationId = reservationId;
  }
}

/**
 * A movement would drive `available` (on_hand - reserved) below zero.
 * The DB trigger doesn't enforce this (adjustments can be signed) — module code
 * raises this for guard-railed flows like checkout commit and transfers.
 */
export class NegativeAvailableError extends InventoryError {
  public readonly variantId: string;
  public readonly locationId: string;
  public readonly resultingAvailable: number;

  constructor(variantId: string, locationId: string, resultingAvailable: number) {
    super(
      `Operation would drive available below zero for variant ${variantId} at location ${locationId} (result: ${resultingAvailable})`,
    );
    this.variantId = variantId;
    this.locationId = locationId;
    this.resultingAvailable = resultingAvailable;
  }
}

/** Transfer endpoints' from/to location mismatch (same location, or one missing). */
export class LocationMismatchError extends InventoryError {
  public readonly fromLocationId: string;
  public readonly toLocationId: string;

  constructor(fromLocationId: string, toLocationId: string, message?: string) {
    super(
      message ??
        `Invalid transfer: from=${fromLocationId}, to=${toLocationId} (must reference distinct existing locations)`,
    );
    this.fromLocationId = fromLocationId;
    this.toLocationId = toLocationId;
  }
}

/** Location id was not found in the current tenant. */
export class LocationNotFoundError extends InventoryError {
  public readonly locationId: string;

  constructor(locationId: string) {
    super(`Location ${locationId} not found`);
    this.locationId = locationId;
  }
}

/**
 * Location is referenced by one or more `stock_levels` rows and cannot be
 * deleted without orphaning inventory state. Caller should drain stock first
 * (transfer / adjust to zero) before retrying.
 */
export class LocationInUseError extends InventoryError {
  public readonly locationId: string;
  public readonly levelCount: number;

  constructor(locationId: string, levelCount: number) {
    super(`Location ${locationId} has ${levelCount} stock level row(s); cannot delete`);
    this.locationId = locationId;
    this.levelCount = levelCount;
  }
}

/** Supplier id was not found in the current tenant. */
export class SupplierNotFoundError extends InventoryError {
  public readonly supplierId: string;

  constructor(supplierId: string) {
    super(`Supplier ${supplierId} not found`);
    this.supplierId = supplierId;
  }
}

/**
 * Supplier has one or more active purchase orders (status not 'received' or
 * 'cancelled') and cannot be deleted.
 */
export class SupplierInUseError extends InventoryError {
  public readonly supplierId: string;
  public readonly activePoCount: number;

  constructor(supplierId: string, activePoCount: number) {
    super(
      `Supplier ${supplierId} has ${activePoCount} active purchase order(s); cannot delete`,
    );
    this.supplierId = supplierId;
    this.activePoCount = activePoCount;
  }
}

/** Purchase order id was not found in the current tenant. */
export class PurchaseOrderNotFoundError extends InventoryError {
  public readonly purchaseOrderId: string;

  constructor(purchaseOrderId: string) {
    super(`Purchase order ${purchaseOrderId} not found`);
    this.purchaseOrderId = purchaseOrderId;
  }
}

/** Threshold for (variantId, locationId) was not found in the current tenant. */
export class ThresholdNotFoundError extends InventoryError {
  public readonly variantId: string;
  public readonly locationId: string;

  constructor(variantId: string, locationId: string) {
    super(`Threshold for variant ${variantId} at location ${locationId} not found`);
    this.variantId = variantId;
    this.locationId = locationId;
  }
}

/**
 * A purchase-order receive call attempted to receive more units of a variant
 * than remain outstanding (`qty_ordered - qty_received`).
 */
export class OverReceiveError extends InventoryError {
  public readonly purchaseOrderId: string;
  public readonly variantId: string;
  public readonly requested: number;
  public readonly outstanding: number;

  constructor(
    purchaseOrderId: string,
    variantId: string,
    requested: number,
    outstanding: number,
  ) {
    super(
      `Cannot receive ${requested} of variant ${variantId} on PO ${purchaseOrderId}: only ${outstanding} outstanding`,
    );
    this.purchaseOrderId = purchaseOrderId;
    this.variantId = variantId;
    this.requested = requested;
    this.outstanding = outstanding;
  }
}
