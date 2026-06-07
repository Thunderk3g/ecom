/**
 * Order status pill in the Plume design language (`.status-badge`).
 *
 * Maps the `order_status` enum to the four Plume badge variants:
 *   - completed / fulfilled  → delivered (green)
 *   - paid                   → in transit (gold)
 *   - cancelled              → cancelled (red)
 *   - pending_payment / refunded / other → processing (neutral)
 */
const LABELS: Record<string, string> = {
  pending_payment: 'Pending payment',
  paid: 'Paid',
  fulfilled: 'Fulfilled',
  completed: 'Completed',
  cancelled: 'Cancelled',
  refunded: 'Refunded',
};

export function OrderStatusBadge({ status }: { status: string }) {
  const variant =
    status === 'completed' || status === 'fulfilled'
      ? 'sb-delivered'
      : status === 'paid'
        ? 'sb-transit'
        : status === 'cancelled'
          ? 'sb-cancelled'
          : 'sb-processing';

  const dotClass = variant === 'sb-transit' ? 'dot warn' : 'dot';
  const label = LABELS[status] ?? status.replace(/_/g, ' ');

  return (
    <span className={`status-badge ${variant}`}>
      <span className={dotClass} />
      {label}
    </span>
  );
}
