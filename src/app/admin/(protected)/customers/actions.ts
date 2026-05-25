'use server';

import { revalidatePath } from 'next/cache';
import { requireAdmin } from '../_lib/context';
import {
  createAddress,
  deleteAddress,
  setDefaultAddress,
  updateAddress,
  type AddressType,
  type DefaultSlot,
} from '@/modules/customers/addresses';

export type ActionResult<T = void> =
  | { ok: true; data: T }
  | { ok: false; error: string };

function errMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return 'Unexpected error';
}

export type AddressInput = {
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
};

export async function createAddressAction(
  customerId: string,
  input: AddressInput,
): Promise<ActionResult<{ id: string }>> {
  try {
    const ctx = await requireAdmin('customers:write');
    const row = await createAddress(ctx.storeId, customerId, {
      type: input.type,
      name: input.name,
      line1: input.line1,
      line2: input.line2 ?? null,
      city: input.city,
      region: input.region,
      postal: input.postal,
      country: input.country,
      phone: input.phone ?? null,
      ...(input.isDefault !== undefined ? { isDefault: input.isDefault } : {}),
    });
    revalidatePath(`/admin/customers/${customerId}`);
    return { ok: true, data: { id: row.id } };
  } catch (err) {
    return { ok: false, error: errMessage(err) };
  }
}

export async function updateAddressAction(
  customerId: string,
  addressId: string,
  input: AddressInput,
): Promise<ActionResult> {
  try {
    const ctx = await requireAdmin('customers:write');
    await updateAddress(ctx.storeId, addressId, {
      type: input.type,
      name: input.name,
      line1: input.line1,
      line2: input.line2 ?? null,
      city: input.city,
      region: input.region,
      postal: input.postal,
      country: input.country,
      phone: input.phone ?? null,
    });
    revalidatePath(`/admin/customers/${customerId}`);
    return { ok: true, data: undefined };
  } catch (err) {
    return { ok: false, error: errMessage(err) };
  }
}

export async function deleteAddressAction(
  customerId: string,
  addressId: string,
): Promise<ActionResult> {
  try {
    const ctx = await requireAdmin('customers:write');
    await deleteAddress(ctx.storeId, addressId);
    revalidatePath(`/admin/customers/${customerId}`);
    return { ok: true, data: undefined };
  } catch (err) {
    return { ok: false, error: errMessage(err) };
  }
}

export async function setDefaultAddressAction(
  customerId: string,
  addressId: string,
  slot: DefaultSlot,
): Promise<ActionResult> {
  try {
    const ctx = await requireAdmin('customers:write');
    await setDefaultAddress(ctx.storeId, customerId, addressId, slot);
    revalidatePath(`/admin/customers/${customerId}`);
    return { ok: true, data: undefined };
  } catch (err) {
    return { ok: false, error: errMessage(err) };
  }
}
