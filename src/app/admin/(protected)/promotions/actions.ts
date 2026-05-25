'use server';

import { revalidatePath } from 'next/cache';
import { and, eq, ne } from 'drizzle-orm';
import { requireAdmin } from '../_lib/context';
import { withTenant } from '@/modules/tenant/with-tenant';
import {
  promotions,
  type PromotionConditions,
} from '@/db/schema/promotions';

export type PromotionType = 'percent' | 'amount' | 'free_shipping' | 'bxgy';
export type PromotionStatus = 'draft' | 'active' | 'paused' | 'archived';

export type ActionResult<T = void> =
  | { ok: true; data: T }
  | { ok: false; error: string };

function errMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return 'Unexpected error';
}

/**
 * Form-shaped promotion input. The form maps each promotion `type` to the
 * fields it needs (percent / valueCents / bxgy buy+get); the action below
 * normalizes the per-type fields before writing.
 */
export type PromotionFormInput = {
  code: string;
  name: string;
  type: PromotionType;
  status: PromotionStatus;
  /** 0..100 — used when type is 'percent'. */
  percent: number | null;
  /** Integer minor units — used when type is 'amount'. */
  valueCents: number | null;
  /** Integer minor units — eligibility gate. */
  minSubtotalCents: number | null;
  /** Buy N — used when type is 'bxgy'. */
  bxgyBuy: number | null;
  /** Get M — used when type is 'bxgy'. */
  bxgyGet: number | null;
  /** ISO datetime string or empty for null. */
  startsAt: string;
  /** ISO datetime string or empty for null. */
  endsAt: string;
  usageLimit: number | null;
  perCustomerLimit: number | null;
  stackable: boolean;
};

function buildConditions(input: PromotionFormInput): PromotionConditions {
  const conditions: PromotionConditions = {};
  if (input.minSubtotalCents !== null && input.minSubtotalCents >= 0) {
    conditions.minSubtotalCents = input.minSubtotalCents;
  }
  if (input.type === 'bxgy') {
    if (input.bxgyBuy !== null && input.bxgyBuy > 0) {
      conditions.bxgyBuy = input.bxgyBuy;
    }
    if (input.bxgyGet !== null && input.bxgyGet > 0) {
      conditions.bxgyGet = input.bxgyGet;
    }
  }
  return conditions;
}

function validateForm(input: PromotionFormInput): string | null {
  if (!input.name.trim()) return 'Name is required';
  if (input.type === 'percent') {
    if (input.percent === null || input.percent < 0 || input.percent > 100) {
      return 'Percent must be between 0 and 100';
    }
  }
  if (input.type === 'amount') {
    if (input.valueCents === null || input.valueCents < 0) {
      return 'Amount must be zero or greater';
    }
  }
  if (input.type === 'bxgy') {
    if (input.bxgyBuy === null || input.bxgyBuy <= 0) {
      return 'Buy quantity must be positive';
    }
    if (input.bxgyGet === null || input.bxgyGet <= 0) {
      return 'Get quantity must be positive';
    }
  }
  if (input.startsAt && Number.isNaN(Date.parse(input.startsAt))) {
    return 'Starts-at must be a valid date';
  }
  if (input.endsAt && Number.isNaN(Date.parse(input.endsAt))) {
    return 'Ends-at must be a valid date';
  }
  if (input.startsAt && input.endsAt) {
    if (new Date(input.startsAt).getTime() > new Date(input.endsAt).getTime()) {
      return 'Starts-at must be before ends-at';
    }
  }
  return null;
}

export async function createPromotionAction(
  input: PromotionFormInput,
): Promise<ActionResult<{ id: string }>> {
  try {
    const ctx = await requireAdmin('promotions:write');
    const err = validateForm(input);
    if (err) return { ok: false, error: err };

    const code = input.code.trim() ? input.code.trim() : null;
    const conditions = buildConditions(input);

    const id = await withTenant(ctx.storeId, async tx => {
      if (code) {
        const [clash] = await tx
          .select({ id: promotions.id })
          .from(promotions)
          .where(eq(promotions.code, code))
          .limit(1);
        if (clash) {
          throw new Error(`Code "${code}" is already in use`);
        }
      }
      const [row] = await tx
        .insert(promotions)
        .values({
          storeId: ctx.storeId,
          code,
          name: input.name.trim(),
          type: input.type,
          status: input.status,
          percent: input.type === 'percent' ? input.percent : null,
          valueCents: input.type === 'amount' ? input.valueCents : null,
          conditions,
          startsAt: input.startsAt ? new Date(input.startsAt) : null,
          endsAt: input.endsAt ? new Date(input.endsAt) : null,
          usageLimit: input.usageLimit,
          perCustomerLimit: input.perCustomerLimit,
          stackable: input.stackable,
        })
        .returning({ id: promotions.id });
      if (!row) throw new Error('Insert returned no row');
      return row.id;
    });

    revalidatePath('/admin/promotions');
    return { ok: true, data: { id } };
  } catch (err) {
    return { ok: false, error: errMessage(err) };
  }
}

export async function updatePromotionAction(
  id: string,
  input: PromotionFormInput,
): Promise<ActionResult> {
  try {
    const ctx = await requireAdmin('promotions:write');
    const err = validateForm(input);
    if (err) return { ok: false, error: err };

    const code = input.code.trim() ? input.code.trim() : null;
    const conditions = buildConditions(input);

    await withTenant(ctx.storeId, async tx => {
      const [existing] = await tx
        .select({ id: promotions.id, code: promotions.code })
        .from(promotions)
        .where(eq(promotions.id, id))
        .limit(1);
      if (!existing) throw new Error('Promotion not found');

      if (code && code !== existing.code) {
        const [clash] = await tx
          .select({ id: promotions.id })
          .from(promotions)
          .where(and(eq(promotions.code, code), ne(promotions.id, id)))
          .limit(1);
        if (clash) throw new Error(`Code "${code}" is already in use`);
      }

      await tx
        .update(promotions)
        .set({
          code,
          name: input.name.trim(),
          type: input.type,
          status: input.status,
          percent: input.type === 'percent' ? input.percent : null,
          valueCents: input.type === 'amount' ? input.valueCents : null,
          conditions,
          startsAt: input.startsAt ? new Date(input.startsAt) : null,
          endsAt: input.endsAt ? new Date(input.endsAt) : null,
          usageLimit: input.usageLimit,
          perCustomerLimit: input.perCustomerLimit,
          stackable: input.stackable,
        })
        .where(eq(promotions.id, id));
    });

    revalidatePath('/admin/promotions');
    revalidatePath(`/admin/promotions/${id}`);
    return { ok: true, data: undefined };
  } catch (err) {
    return { ok: false, error: errMessage(err) };
  }
}

export async function archivePromotionAction(id: string): Promise<ActionResult> {
  try {
    const ctx = await requireAdmin('promotions:write');
    await withTenant(ctx.storeId, async tx => {
      const [existing] = await tx
        .select({ id: promotions.id })
        .from(promotions)
        .where(eq(promotions.id, id))
        .limit(1);
      if (!existing) throw new Error('Promotion not found');
      await tx
        .update(promotions)
        .set({ status: 'archived' })
        .where(eq(promotions.id, id));
    });
    revalidatePath('/admin/promotions');
    revalidatePath(`/admin/promotions/${id}`);
    return { ok: true, data: undefined };
  } catch (err) {
    return { ok: false, error: errMessage(err) };
  }
}
