'use server';

import { revalidatePath } from 'next/cache';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { SESSION_COOKIE, sessionCookieOptions, unsign } from '@/lib/cookies';
import { invalidateSession } from '@/modules/auth/session';
import {
  createAddress,
  deleteAddress,
  getAddress,
  setDefaultAddress,
  updateAddress,
  type AddressType,
  type DefaultSlot,
} from '@/modules/customers/addresses';
import {
  AddressNotFoundError,
  CustomerError,
} from '@/modules/customers/errors';
import { getAccountContext } from './_lib';

/**
 * Server Actions for the storefront `/account/*` pages.
 *
 * Auth: every mutation resolves `getAccountContext()` first, which redirects to
 * `/` if the customer session is missing or invalid. CSRF is provided by
 * Next.js's built-in Server Action protocol (no manual `x-csrf-token` plumbing
 * is needed when calling actions from server-rendered forms / from client
 * components via the React runtime).
 *
 * Ownership: address mutations verify the target address belongs to the
 * authenticated customer before delegating. Cross-customer ids return an
 * `address-not-found` error result — never disclose enumeration.
 */

export type ActionResult<T = void> =
  | { ok: true; data: T }
  | { ok: false; error: string };

function errMessage(err: unknown): string {
  if (err instanceof CustomerError) return err.message;
  if (err instanceof Error) return err.message;
  return 'Unexpected error';
}

const ADDRESS_TYPES: AddressType[] = ['billing', 'shipping', 'both'];
const DEFAULT_SLOTS: DefaultSlot[] = ['billing', 'shipping'];

// ─────────────────────────────────────────────────────────────────────────────
// Address CRUD
// ─────────────────────────────────────────────────────────────────────────────

export type CreateAddressFormInput = {
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
  input: CreateAddressFormInput,
): Promise<ActionResult<{ id: string }>> {
  try {
    const ctx = await getAccountContext();
    if (!ADDRESS_TYPES.includes(input.type)) {
      return { ok: false, error: 'Invalid address type' };
    }
    const created = await createAddress(ctx.storeId, ctx.customer.id, {
      type: input.type,
      name: input.name,
      line1: input.line1,
      ...(input.line2 !== undefined ? { line2: input.line2 } : {}),
      city: input.city,
      region: input.region,
      postal: input.postal,
      country: input.country,
      ...(input.phone !== undefined ? { phone: input.phone } : {}),
      ...(input.isDefault !== undefined ? { isDefault: input.isDefault } : {}),
    });
    revalidatePath('/account/addresses');
    revalidatePath('/account');
    return { ok: true, data: { id: created.id } };
  } catch (err) {
    return { ok: false, error: errMessage(err) };
  }
}

export type UpdateAddressFormInput = {
  type?: AddressType;
  name?: string;
  line1?: string;
  line2?: string | null;
  city?: string;
  region?: string;
  postal?: string;
  country?: string;
  phone?: string | null;
};

export async function updateAddressAction(
  addressId: string,
  input: UpdateAddressFormInput,
): Promise<ActionResult> {
  try {
    const ctx = await getAccountContext();
    const existing = await getAddress(ctx.storeId, addressId);
    if (existing.customerId !== ctx.customer.id) {
      // Mirror the API: don't disclose foreign address existence.
      return { ok: false, error: `Address not found: ${addressId}` };
    }
    if (input.type !== undefined && !ADDRESS_TYPES.includes(input.type)) {
      return { ok: false, error: 'Invalid address type' };
    }
    await updateAddress(ctx.storeId, addressId, {
      ...(input.type !== undefined ? { type: input.type } : {}),
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.line1 !== undefined ? { line1: input.line1 } : {}),
      ...(input.line2 !== undefined ? { line2: input.line2 } : {}),
      ...(input.city !== undefined ? { city: input.city } : {}),
      ...(input.region !== undefined ? { region: input.region } : {}),
      ...(input.postal !== undefined ? { postal: input.postal } : {}),
      ...(input.country !== undefined ? { country: input.country } : {}),
      ...(input.phone !== undefined ? { phone: input.phone } : {}),
    });
    revalidatePath('/account/addresses');
    return { ok: true, data: undefined };
  } catch (err) {
    if (err instanceof AddressNotFoundError) {
      return { ok: false, error: err.message };
    }
    return { ok: false, error: errMessage(err) };
  }
}

export async function deleteAddressAction(
  addressId: string,
): Promise<ActionResult> {
  try {
    const ctx = await getAccountContext();
    const existing = await getAddress(ctx.storeId, addressId);
    if (existing.customerId !== ctx.customer.id) {
      return { ok: false, error: `Address not found: ${addressId}` };
    }
    await deleteAddress(ctx.storeId, addressId);
    revalidatePath('/account/addresses');
    revalidatePath('/account');
    return { ok: true, data: undefined };
  } catch (err) {
    if (err instanceof AddressNotFoundError) {
      return { ok: false, error: err.message };
    }
    return { ok: false, error: errMessage(err) };
  }
}

export async function setDefaultAddressAction(
  addressId: string,
  slot: DefaultSlot,
): Promise<ActionResult> {
  try {
    const ctx = await getAccountContext();
    if (!DEFAULT_SLOTS.includes(slot)) {
      return { ok: false, error: 'Invalid default slot' };
    }
    const existing = await getAddress(ctx.storeId, addressId);
    if (existing.customerId !== ctx.customer.id) {
      return { ok: false, error: `Address not found: ${addressId}` };
    }
    await setDefaultAddress(ctx.storeId, ctx.customer.id, addressId, slot);
    revalidatePath('/account/addresses');
    return { ok: true, data: undefined };
  } catch (err) {
    if (err instanceof AddressNotFoundError) {
      return { ok: false, error: err.message };
    }
    return { ok: false, error: errMessage(err) };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Logout
// ─────────────────────────────────────────────────────────────────────────────

/**
 * End the storefront customer session.
 *
 * Mirrors `POST /api/v1/auth/logout`: invalidates the DB row and clears the
 * `sid` cookie. Redirects to `/` so the page that called the action doesn't
 * try to render a logged-in view against a now-empty session.
 */
export async function logoutAction(): Promise<never> {
  const jar = await cookies();
  const signed = jar.get(SESSION_COOKIE)?.value;
  if (signed) {
    const sid = unsign(signed);
    if (sid) {
      await invalidateSession(sid);
    }
  }
  jar.set(SESSION_COOKIE, '', { ...sessionCookieOptions, maxAge: 0 });
  redirect('/');
}
