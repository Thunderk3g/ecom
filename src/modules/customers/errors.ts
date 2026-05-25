/**
 * Named error classes for the customers module.
 *
 * Module-service code throws these directly. HTTP route handlers (Stream F)
 * catch them and translate to RFC 7807 problem+json responses via the shared
 * `problem()` helper.
 */

export class CustomerError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

/** Customer id (or lookup key) was not found in the current tenant. */
export class CustomerNotFoundError extends CustomerError {
  public readonly identifier: string;

  constructor(identifier: string) {
    super(`Customer not found: ${identifier}`);
    this.identifier = identifier;
  }
}

/** Address id was not found in the current tenant. */
export class AddressNotFoundError extends CustomerError {
  public readonly addressId: string;

  constructor(addressId: string) {
    super(`Address not found: ${addressId}`);
    this.addressId = addressId;
  }
}

/**
 * Attempted to register / link a customer whose email is already owned by a
 * different (user-bound) customer in the same store. Distinct from a guest-row
 * collision, which `upsertCustomer` is allowed to merge into.
 */
export class EmailConflictError extends CustomerError {
  public readonly email: string;

  constructor(email: string) {
    super(`Email already registered to a different customer: ${email}`);
    this.email = email;
  }
}
