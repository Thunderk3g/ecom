import { Badge } from '@/components/ui/badge';
import { ORDER_STATUS_VARIANT } from '../_status';

/** Renders an order status (or any related status string) as a coloured badge. */
export function StatusBadge({ status }: { status: string }) {
  const variant = ORDER_STATUS_VARIANT[status] ?? 'secondary';
  return <Badge variant={variant}>{status}</Badge>;
}
