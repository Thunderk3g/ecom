/**
 * Addresses module — saved address book per customer.
 *
 * Addresses inherit tenant scope through their parent `customers.store_id`
 * (no direct `store_id` column on `addresses`). RLS uses a parent-join policy,
 * so every operation MUST go through `withTenant(storeId, ...)`.
 *
 * Default-address rules: exactly one row per (customer, semantic-type) carries
 * `is_default = true`. Address rows have a `type` of `'billing' | 'shipping' |
 * 'both'`. `setDefaultAddress` accepts the semantic type ('billing' or
 * 'shipping') and unsets any prior default that matches that semantic type —
 * which includes both same-typed rows AND rows typed `'both'`.
 */

import { and, eq, ne, inArray, type SQL } from 'drizzle-orm';
import { withTenant } from '@/modules/tenant/with-tenant';
import { addresses, customers } from '@/db/schema/customers';
import {
  AddressNotFoundError,
  CustomerNotFoundError,
} from './errors';

export type AddressRow = typeof addresses.$inferSelect;
export type AddressType = AddressRow['type'];
/** Semantic default slot — 'both' addresses can fill either slot. */
export type DefaultSlot = 'billing' | 'shipping';

export interface CreateAddressInput {
  type: AddressType;
  name: string;
  line1: string;
  line2?: string | null;
  city: string;
  region: string;
  postal: string;
  country: string;
  phone?: string | null;
  isDefault?: boolean;
}

export interface UpdateAddressInput {
  type?: AddressType;
  name?: string;
  line1?: string;
  line2?: string | null;
  city?: string;
  region?: string;
  postal?: string;
  country?: string;
  phone?: string | null;
}

/**
 * The set of `addresses.type` values that satisfy a given semantic default
 * slot. A `'both'` row counts for either side; a `'billing'` row only fills
 * the billing slot; a `'shipping'` row only fills the shipping slot.
 */
function typesForSlot(slot: DefaultSlot): AddressType[] {
  return slot === 'billing' ? ['billing', 'both'] : ['shipping', 'both'];
}

async function assertCustomerExists(
  tx: Parameters<Parameters<typeof withTenant>[1]>[0],
  customerId: string,
): Promise<void> {
  const [row] = await tx
    .select({ id: customers.id })
    .from(customers)
    .where(eq(customers.id, customerId))
    .limit(1);
  if (!row) throw new CustomerNotFoundError(customerId);
}

export async function listAddresses(
  storeId: string,
  customerId: string,
): Promise<AddressRow[]> {
  return withTenant(storeId, async tx => {
    await assertCustomerExists(tx, customerId);
    return tx
      .select()
      .from(addresses)
      .where(eq(addresses.customerId, customerId))
      .orderBy(addresses.createdAt);
  });
}

export async function getAddress(
  storeId: string,
  addressId: string,
): Promise<AddressRow> {
  return withTenant(storeId, async tx => {
    const [row] = await tx
      .select()
      .from(addresses)
      .where(eq(addresses.id, addressId))
      .limit(1);
    if (!row) throw new AddressNotFoundError(addressId);
    return row;
  });
}

export async function createAddress(
  storeId: string,
  customerId: string,
  input: CreateAddressInput,
): Promise<AddressRow> {
  return withTenant(storeId, async tx => {
    await assertCustomerExists(tx, customerId);

    // If this row is being inserted as default, unset prior defaults whose
    // semantic type overlaps. A 'both' insert clears defaults for both slots;
    // a 'billing' or 'shipping' insert only clears the matching slot(s).
    if (input.isDefault) {
      const slotsToClear: DefaultSlot[] =
        input.type === 'both' ? ['billing', 'shipping'] : [input.type];
      const typesToUnset = Array.from(
        new Set(slotsToClear.flatMap(typesForSlot)),
      );
      await tx
        .update(addresses)
        .set({ isDefault: false })
        .where(
          and(
            eq(addresses.customerId, customerId),
            eq(addresses.isDefault, true),
            inArray(addresses.type, typesToUnset),
          ),
        );
    }

    const [inserted] = await tx
      .insert(addresses)
      .values({
        customerId,
        type: input.type,
        name: input.name,
        line1: input.line1,
        line2: input.line2 ?? null,
        city: input.city,
        region: input.region,
        postal: input.postal,
        country: input.country,
        phone: input.phone ?? null,
        isDefault: input.isDefault ?? false,
      })
      .returning();
    if (!inserted) throw new Error('addresses insert returned no row');
    return inserted;
  });
}

export async function updateAddress(
  storeId: string,
  addressId: string,
  patch: UpdateAddressInput,
): Promise<AddressRow> {
  return withTenant(storeId, async tx => {
    const setPatch: {
      type?: AddressType;
      name?: string;
      line1?: string;
      line2?: string | null;
      city?: string;
      region?: string;
      postal?: string;
      country?: string;
      phone?: string | null;
    } = {};
    if (patch.type !== undefined) setPatch.type = patch.type;
    if (patch.name !== undefined) setPatch.name = patch.name;
    if (patch.line1 !== undefined) setPatch.line1 = patch.line1;
    if (patch.line2 !== undefined) setPatch.line2 = patch.line2;
    if (patch.city !== undefined) setPatch.city = patch.city;
    if (patch.region !== undefined) setPatch.region = patch.region;
    if (patch.postal !== undefined) setPatch.postal = patch.postal;
    if (patch.country !== undefined) setPatch.country = patch.country;
    if (patch.phone !== undefined) setPatch.phone = patch.phone;

    if (Object.keys(setPatch).length === 0) {
      const [row] = await tx
        .select()
        .from(addresses)
        .where(eq(addresses.id, addressId))
        .limit(1);
      if (!row) throw new AddressNotFoundError(addressId);
      return row;
    }

    const [updated] = await tx
      .update(addresses)
      .set(setPatch)
      .where(eq(addresses.id, addressId))
      .returning();
    if (!updated) throw new AddressNotFoundError(addressId);
    return updated;
  });
}

export async function deleteAddress(
  storeId: string,
  addressId: string,
): Promise<void> {
  await withTenant(storeId, async tx => {
    const [existing] = await tx
      .select({ id: addresses.id })
      .from(addresses)
      .where(eq(addresses.id, addressId))
      .limit(1);
    if (!existing) throw new AddressNotFoundError(addressId);

    await tx.delete(addresses).where(eq(addresses.id, addressId));
  });
}

/**
 * Atomically promote `addressId` to the default for the given semantic slot,
 * unsetting any prior default for that slot belonging to the same customer.
 *
 * `slot='billing'` unsets defaults on rows typed 'billing' or 'both';
 * `slot='shipping'` unsets defaults on rows typed 'shipping' or 'both'.
 *
 * The target address itself must already be typed in a way that is compatible
 * with the requested slot (its type must be the slot or 'both'). We do NOT
 * silently mutate its type — callers should `updateAddress` first if needed.
 */
export async function setDefaultAddress(
  storeId: string,
  customerId: string,
  addressId: string,
  slot: DefaultSlot,
): Promise<AddressRow> {
  return withTenant(storeId, async tx => {
    await assertCustomerExists(tx, customerId);

    const [target] = await tx
      .select()
      .from(addresses)
      .where(
        and(eq(addresses.id, addressId), eq(addresses.customerId, customerId)),
      )
      .limit(1);
    if (!target) throw new AddressNotFoundError(addressId);

    const compatibleTypes = typesForSlot(slot);
    if (!compatibleTypes.includes(target.type)) {
      // Same shape as not-found: HTTP layer can map this to 422 separately
      // if needed. Reusing the typed error keeps the contract simple.
      throw new AddressNotFoundError(addressId);
    }

    // Unset prior defaults for the affected slot, excluding the target row.
    const conditions: SQL[] = [
      eq(addresses.customerId, customerId),
      eq(addresses.isDefault, true),
      inArray(addresses.type, compatibleTypes),
      ne(addresses.id, addressId),
    ];
    await tx
      .update(addresses)
      .set({ isDefault: false })
      .where(and(...conditions));

    if (target.isDefault) return target;

    const [updated] = await tx
      .update(addresses)
      .set({ isDefault: true })
      .where(eq(addresses.id, addressId))
      .returning();
    if (!updated) throw new AddressNotFoundError(addressId);
    return updated;
  });
}
