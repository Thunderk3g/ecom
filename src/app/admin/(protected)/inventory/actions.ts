'use server';

import { revalidatePath } from 'next/cache';
import { requireAdmin } from '../_lib/context';
import { adjustStock } from '@/modules/inventory/movements';
import {
  createLocation,
  updateLocation,
  deleteLocation,
  type LocationType,
} from '@/modules/inventory/locations';
import {
  createSupplier,
  updateSupplier,
  deleteSupplier,
} from '@/modules/inventory/suppliers';
import { setThreshold } from '@/modules/inventory/thresholds';
import {
  createPurchaseOrder,
  receivePurchaseOrder,
  updatePurchaseOrder,
  type PoStatus,
} from '@/modules/inventory/purchase-orders';

export type ActionResult<T = void> =
  | { ok: true; data: T }
  | { ok: false; error: string };

function errMessage(err: unknown): string {
  return err instanceof Error ? err.message : 'Unexpected error';
}

export async function adjustStockAction(input: {
  variantId: string;
  locationId: string;
  delta: number;
  reason: string;
}): Promise<ActionResult> {
  try {
    const ctx = await requireAdmin('inventory:write');
    await adjustStock(ctx.storeId, {
      variantId: input.variantId,
      locationId: input.locationId,
      delta: input.delta,
      reason: input.reason || 'manual_correction',
      createdBy: ctx.session.userId,
    });
    revalidatePath('/admin/inventory');
    return { ok: true, data: undefined };
  } catch (err) {
    return { ok: false, error: errMessage(err) };
  }
}

export async function createLocationAction(input: {
  code: string;
  name: string;
  type: LocationType;
}): Promise<ActionResult> {
  try {
    const ctx = await requireAdmin('inventory:write');
    await createLocation(ctx.storeId, input);
    revalidatePath('/admin/inventory/locations');
    return { ok: true, data: undefined };
  } catch (err) {
    return { ok: false, error: errMessage(err) };
  }
}

export async function updateLocationAction(
  id: string,
  input: { code: string; name: string; type: LocationType },
): Promise<ActionResult> {
  try {
    const ctx = await requireAdmin('inventory:write');
    await updateLocation(ctx.storeId, id, input);
    revalidatePath('/admin/inventory/locations');
    return { ok: true, data: undefined };
  } catch (err) {
    return { ok: false, error: errMessage(err) };
  }
}

export async function deleteLocationAction(id: string): Promise<ActionResult> {
  try {
    const ctx = await requireAdmin('inventory:write');
    await deleteLocation(ctx.storeId, id);
    revalidatePath('/admin/inventory/locations');
    return { ok: true, data: undefined };
  } catch (err) {
    return { ok: false, error: errMessage(err) };
  }
}

export async function createSupplierAction(input: {
  name: string;
  email?: string;
  phone?: string;
  leadTimeDays?: number;
}): Promise<ActionResult> {
  try {
    const ctx = await requireAdmin('inventory:write');
    await createSupplier(ctx.storeId, {
      name: input.name,
      contact:
        input.email || input.phone
          ? { ...(input.email ? { email: input.email } : {}), ...(input.phone ? { phone: input.phone } : {}) }
          : undefined,
      ...(input.leadTimeDays !== undefined ? { leadTimeDays: input.leadTimeDays } : {}),
    });
    revalidatePath('/admin/inventory/suppliers');
    return { ok: true, data: undefined };
  } catch (err) {
    return { ok: false, error: errMessage(err) };
  }
}

export async function updateSupplierAction(
  id: string,
  input: { name: string; email?: string; phone?: string; leadTimeDays?: number },
): Promise<ActionResult> {
  try {
    const ctx = await requireAdmin('inventory:write');
    await updateSupplier(ctx.storeId, id, {
      name: input.name,
      contact: {
        ...(input.email ? { email: input.email } : {}),
        ...(input.phone ? { phone: input.phone } : {}),
      },
      leadTimeDays: input.leadTimeDays ?? null,
    });
    revalidatePath('/admin/inventory/suppliers');
    return { ok: true, data: undefined };
  } catch (err) {
    return { ok: false, error: errMessage(err) };
  }
}

export async function deleteSupplierAction(id: string): Promise<ActionResult> {
  try {
    const ctx = await requireAdmin('inventory:write');
    await deleteSupplier(ctx.storeId, id);
    revalidatePath('/admin/inventory/suppliers');
    return { ok: true, data: undefined };
  } catch (err) {
    return { ok: false, error: errMessage(err) };
  }
}

export async function setThresholdAction(input: {
  variantId: string;
  locationId: string;
  reorderPoint: number;
  reorderQty: number;
}): Promise<ActionResult> {
  try {
    const ctx = await requireAdmin('inventory:write');
    await setThreshold(ctx.storeId, input);
    revalidatePath('/admin/inventory/thresholds');
    return { ok: true, data: undefined };
  } catch (err) {
    return { ok: false, error: errMessage(err) };
  }
}

export async function createPurchaseOrderAction(input: {
  supplierId: string;
  items: Array<{ variantId: string; qtyOrdered: number; costCents: number }>;
}): Promise<ActionResult<{ id: string }>> {
  try {
    const ctx = await requireAdmin('inventory:write');
    const po = await createPurchaseOrder(ctx.storeId, {
      supplierId: input.supplierId,
      status: 'placed',
      placedAt: new Date(),
      items: input.items,
    });
    revalidatePath('/admin/inventory/purchase-orders');
    return { ok: true, data: { id: po.id } };
  } catch (err) {
    return { ok: false, error: errMessage(err) };
  }
}

export async function updatePurchaseOrderStatusAction(
  id: string,
  status: PoStatus,
): Promise<ActionResult> {
  try {
    const ctx = await requireAdmin('inventory:write');
    await updatePurchaseOrder(ctx.storeId, id, { status });
    revalidatePath('/admin/inventory/purchase-orders');
    return { ok: true, data: undefined };
  } catch (err) {
    return { ok: false, error: errMessage(err) };
  }
}

export async function receivePurchaseOrderAction(input: {
  poId: string;
  items: Array<{ variantId: string; qty: number; locationId: string }>;
}): Promise<ActionResult> {
  try {
    const ctx = await requireAdmin('inventory:write');
    await receivePurchaseOrder(ctx.storeId, {
      poId: input.poId,
      items: input.items,
      createdBy: ctx.session.userId,
    });
    revalidatePath('/admin/inventory/purchase-orders');
    revalidatePath('/admin/inventory');
    return { ok: true, data: undefined };
  } catch (err) {
    return { ok: false, error: errMessage(err) };
  }
}
