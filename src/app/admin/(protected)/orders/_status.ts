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
