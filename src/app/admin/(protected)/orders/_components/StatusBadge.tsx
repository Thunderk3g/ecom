import { statpillClass, statusLabel } from '../_status';

/** Renders an order status (or any related status string) as a Plume statpill. */
export function StatusBadge({ status }: { status: string }) {
  return (
    <span className={`statpill ${statpillClass(status)}`}>
      {statusLabel(status)}
    </span>
  );
}
