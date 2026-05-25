/**
 * Refund flow — partial and full, provider success + failure paths.
 *
 * createRefund flow under test:
 *   1. INSERT refunds row 'pending' + refund_items + 'refund.created' event.
 *   2. provider.refundPayment(…) returns deterministic refund id.
 *   3. applyRefundSucceeded flips refunds.status='succeeded' and (when the
 *      cumulative refund total covers the order) transitions order.status to
 *      'refunded' + emits 'order.refunded' to the outbox.
 *
 * Cases covered:
 *   - Partial refund (1 of 2 items, amount < order total) → refund 'succeeded'
 *     but order.status stays 'paid' / 'fulfilled'.
 *   - Full refund (all items, amount === order total) → order transitions to
 *     'refunded' AND paymentStatus → 'refunded'.
 *   - RefundAmountExceededError when refund > available.
 *   - Provider-failure path: spy on the fake's refundPayment to throw →
 *     compensating tx flips refunds.status='failed', RefundFailedError raised.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { resetAndMigrate } from './_setup/db';
import { appClient, migratorClient } from '@/db/client';
import { withTenant } from '@/modules/tenant/with-tenant';
import { createRefund } from '@/modules/orders/refund';
import {
  RefundAmountExceededError,
  RefundFailedError,
} from '@/modules/orders/errors';
import { orders } from '@/db/schema/orders';
import { refunds, refundItems } from '@/db/schema/refunds';
import {
  installFakePaymentProviders,
  type FakePaymentProvider,
} from './_setup/fake-payment-provider';
import { createPaidOrder, SYSTEM_ACTOR } from './_setup/order-fixtures';

describe('refund flow', () => {
  let fakeRazorpay: FakePaymentProvider;
  let uninstall: () => void;

  beforeAll(async () => {
    await resetAndMigrate();
    const installed = installFakePaymentProviders();
    fakeRazorpay = installed.fakeRazorpay;
    uninstall = installed.uninstall;
  });

  afterAll(async () => {
    uninstall();
    await appClient.end();
    await migratorClient.end();
  });

  it('partial refund: order.status stays paid', async () => {
    const f = await createPaidOrder({ slug: 'rf-partial' });
    // Default fixture: A qty=2 @10000 = 20000, B qty=1 @5000 = 5000, total=25000.
    // Refund 1 of A @ 10000 → partial.
    const result = await createRefund(f.storeId, {
      orderId: f.orderId,
      items: [{ orderItemId: f.orderItemId, qty: 1, amountCents: 10000 }],
      reason: 'customer changed mind',
      actor: SYSTEM_ACTOR,
    });

    expect(result.succeeded).toBe(true);
    expect(result.orderRefunded).toBe(false);
    expect(result.refund.status).toBe('succeeded');
    expect(result.refund.amountCents).toBe(10000);
    expect(result.refund.providerRef).not.toBeNull();

    // Order untouched.
    const o = await withTenant(f.storeId, async tx =>
      tx.select().from(orders).where(eq(orders.id, f.orderId)),
    );
    expect(o[0]?.status).toBe('paid');
    expect(o[0]?.paymentStatus).toBe('paid');

    // Provider was called with the refund's id as idempotency key.
    const lastCall = fakeRazorpay.refundCalls[fakeRazorpay.refundCalls.length - 1];
    expect(lastCall?.idempotencyKey).toBe(result.refund.id);
    expect(lastCall?.amountCents).toBe(10000);
    expect(lastCall?.providerRef).toBe(f.paymentProviderRef);
  });

  it('full refund: order transitions to refunded', async () => {
    const f = await createPaidOrder({ slug: 'rf-full' });
    // Refund both items in full.
    const result = await createRefund(f.storeId, {
      orderId: f.orderId,
      items: [
        { orderItemId: f.orderItemId, qty: 2, amountCents: 20000 },
        { orderItemId: f.orderItemBId, qty: 1, amountCents: 5000 },
      ],
      reason: 'full return',
      actor: SYSTEM_ACTOR,
    });

    expect(result.succeeded).toBe(true);
    expect(result.orderRefunded).toBe(true);

    const o = await withTenant(f.storeId, async tx =>
      tx.select().from(orders).where(eq(orders.id, f.orderId)),
    );
    expect(o[0]?.status).toBe('refunded');
    expect(o[0]?.paymentStatus).toBe('refunded');

    // Refund items committed.
    const items = await withTenant(f.storeId, async tx =>
      tx.select().from(refundItems).where(eq(refundItems.refundId, result.refund.id)),
    );
    expect(items).toHaveLength(2);
  });

  it('RefundAmountExceededError when sum > order total', async () => {
    const f = await createPaidOrder({ slug: 'rf-exceed' });
    // First a partial refund of 20000 to soak up most of the budget.
    await createRefund(f.storeId, {
      orderId: f.orderId,
      items: [{ orderItemId: f.orderItemId, qty: 2, amountCents: 20000 }],
      actor: SYSTEM_ACTOR,
    });
    // Now ask for 10000 more — only 5000 left.
    await expect(
      createRefund(f.storeId, {
        orderId: f.orderId,
        items: [{ orderItemId: f.orderItemBId, qty: 1, amountCents: 10000 }],
        actor: SYSTEM_ACTOR,
      }),
    ).rejects.toBeInstanceOf(RefundAmountExceededError);
  });

  it('provider failure → refund.status=failed and RefundFailedError raised', async () => {
    const f = await createPaidOrder({ slug: 'rf-failed' });

    // Force the next refundPayment call to throw. We restore the original
    // implementation afterwards so other tests are unaffected.
    const spy = vi
      .spyOn(fakeRazorpay, 'refundPayment')
      .mockRejectedValueOnce(new Error('provider boom'));

    await expect(
      createRefund(f.storeId, {
        orderId: f.orderId,
        items: [{ orderItemId: f.orderItemId, qty: 1, amountCents: 10000 }],
        actor: SYSTEM_ACTOR,
      }),
    ).rejects.toBeInstanceOf(RefundFailedError);

    // The refund row should have been persisted then flipped to 'failed'.
    const failedRefunds = await withTenant(f.storeId, async tx =>
      tx
        .select()
        .from(refunds)
        .where(and(eq(refunds.orderId, f.orderId), eq(refunds.status, 'failed'))),
    );
    expect(failedRefunds).toHaveLength(1);
    expect((failedRefunds[0]?.raw as Record<string, unknown>)?.error).toContain(
      'provider boom',
    );

    // Order status unchanged.
    const o = await withTenant(f.storeId, async tx =>
      tx.select().from(orders).where(eq(orders.id, f.orderId)),
    );
    expect(o[0]?.status).toBe('paid');

    spy.mockRestore();
  });
});
