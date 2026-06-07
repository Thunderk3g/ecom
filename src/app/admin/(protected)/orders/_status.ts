import type { BadgeProps } from '@/components/ui/badge';

type BadgeVariant = NonNullable<BadgeProps['variant']>;

/** Maps an order status to a Badge variant for consistent coloring. */
export const ORDER_STATUS_VARIANT: Record<string, BadgeVariant> = {
  pending_payment: 'secondary',
  paid: 'default',
  fulfilled: 'default',
  completed: 'default',
  refunded: 'outline',
  cancelled: 'destructive',
};

export const ORDER_STATUSES = [
  'pending_payment',
  'paid',
  'fulfilled',
  'completed',
  'refunded',
  'cancelled',
] as const;

/**
 * Maps any order / payment / fulfillment status string to a Plume `.statpill`
 * variant class. Paid → green, refunded/cancelled/failed → red, fulfilled /
 * completed / delivered / success → green-active, pending/processing → gold,
 * everything else falls back to the neutral draft pill.
 */
export function statpillClass(status: string): string {
  const s = status.toLowerCase();
  if (s === 'paid' || s === 'captured' || s === 'success' || s === 'succeeded') {
    return 'sp-paid';
  }
  if (
    s === 'refunded' ||
    s === 'cancelled' ||
    s === 'canceled' ||
    s === 'failed'
  ) {
    return 'sp-refund';
  }
  if (
    s === 'fulfilled' ||
    s === 'completed' ||
    s === 'delivered' ||
    s === 'shipped'
  ) {
    return 'sp-active';
  }
  if (
    s === 'pending_payment' ||
    s === 'pending' ||
    s === 'processing' ||
    s === 'partial' ||
    s === 'unfulfilled'
  ) {
    return 'sp-low';
  }
  return 'sp-draft';
}

/** Humanises a snake_case status for display in a pill. */
export function statusLabel(status: string): string {
  return status.replace(/_/g, ' ');
}
