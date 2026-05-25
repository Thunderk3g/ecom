'use server';

import { revalidatePath } from 'next/cache';
import { adminActor, requireAdmin } from '../_lib/context';
import { transitionOrder } from '@/modules/orders/lifecycle';
import {
  createFulfillment,
  markShipped,
  markDelivered,
} from '@/modules/orders/fulfillment';
import { createRefund } from '@/modules/orders/refund';

export type ActionResult<T = void> =
  | { ok: true; data: T }
  | { ok: false; error: string };

function errMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return 'Unexpected error';
}

export type FulfillOrderInput = {
  items: Array<{ orderItemId: string; qty: number }>;
  carrier?: string;
  trackingNumber?: string;
};

export async function fulfillOrderAction(
  orderId: string,
  input: FulfillOrderInput,
): Promise<ActionResult<{ fulfillmentId: string }>> {
  try {
    const ctx = await requireAdmin('orders:write');
    if (input.items.length === 0) {
      return { ok: false, error: 'Select at least one item to fulfill' };
    }
    const result = await createFulfillment(ctx.storeId, {
      orderId,
      items: input.items,
      ...(input.carrier ? { carrier: input.carrier } : {}),
      ...(input.trackingNumber ? { trackingNumber: input.trackingNumber } : {}),
      actor: { ...adminActor(ctx), actorType: 'admin' },
    });
    revalidatePath('/admin/orders');
    revalidatePath(`/admin/orders/${orderId}`);
    return { ok: true, data: { fulfillmentId: result.fulfillment.id } };
  } catch (err) {
    return { ok: false, error: errMessage(err) };
  }
}

export type ShipShipmentInput = {
  carrier?: string;
  trackingNumber?: string;
};

/**
 * URL semantics in this stream: a fulfillment and its paired shipment are 1:1,
 * so the admin "shipment" id passed here is in fact the fulfillment id.
 */
export async function shipShipmentAction(
  orderId: string,
  fulfillmentId: string,
  input: ShipShipmentInput,
): Promise<ActionResult> {
  try {
    const ctx = await requireAdmin('orders:write');
    await markShipped(ctx.storeId, fulfillmentId, {
      ...(input.carrier ? { carrier: input.carrier } : {}),
      ...(input.trackingNumber ? { trackingNumber: input.trackingNumber } : {}),
      actor: { ...adminActor(ctx), actorType: 'admin' },
    });
    revalidatePath('/admin/orders');
    revalidatePath(`/admin/orders/${orderId}`);
    return { ok: true, data: undefined };
  } catch (err) {
    return { ok: false, error: errMessage(err) };
  }
}

export async function deliverShipmentAction(
  orderId: string,
  fulfillmentId: string,
): Promise<ActionResult> {
  try {
    const ctx = await requireAdmin('orders:write');
    await markDelivered(ctx.storeId, fulfillmentId, {
      ...adminActor(ctx),
      actorType: 'admin',
    });
    revalidatePath('/admin/orders');
    revalidatePath(`/admin/orders/${orderId}`);
    return { ok: true, data: undefined };
  } catch (err) {
    return { ok: false, error: errMessage(err) };
  }
}

export type RefundOrderInput = {
  items: Array<{ orderItemId: string; qty: number; amountCents: number }>;
  reason?: string;
};

export async function refundOrderAction(
  orderId: string,
  input: RefundOrderInput,
): Promise<ActionResult<{ refundId: string; orderRefunded: boolean }>> {
  try {
    const ctx = await requireAdmin('orders:write');
    if (input.items.length === 0) {
      return { ok: false, error: 'Select at least one item to refund' };
    }
    const result = await createRefund(ctx.storeId, {
      orderId,
      items: input.items,
      ...(input.reason ? { reason: input.reason } : {}),
      actor: { ...adminActor(ctx), actorType: 'admin' },
    });
    revalidatePath('/admin/orders');
    revalidatePath(`/admin/orders/${orderId}`);
    return {
      ok: true,
      data: { refundId: result.refund.id, orderRefunded: result.orderRefunded },
    };
  } catch (err) {
    return { ok: false, error: errMessage(err) };
  }
}

export type CancelOrderInput = {
  reason?: string;
};

export async function cancelOrderAction(
  orderId: string,
  input: CancelOrderInput,
): Promise<ActionResult> {
  try {
    const ctx = await requireAdmin('orders:write');
    await transitionOrder(
      ctx.storeId,
      orderId,
      'cancelled',
      { ...adminActor(ctx), actorType: 'admin' },
      input.reason ? { reason: input.reason } : {},
    );
    revalidatePath('/admin/orders');
    revalidatePath(`/admin/orders/${orderId}`);
    return { ok: true, data: undefined };
  } catch (err) {
    return { ok: false, error: errMessage(err) };
  }
}
