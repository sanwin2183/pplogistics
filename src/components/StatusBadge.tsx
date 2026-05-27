import type { OrderStatus, FlyerStatus } from '../types';
import {
  ORDER_STATUS_CLASSES,
  ORDER_STATUS_LABELS,
  FLYER_STATUS_CLASSES,
  FLYER_STATUS_LABELS,
} from '../lib/status';
import { cn } from '../lib/utils';

export function OrderStatusBadge({ status, className }: { status: OrderStatus; className?: string }) {
  return (
    <span className={cn('status-pill', ORDER_STATUS_CLASSES[status], className)}>
      <span className="h-1.5 w-1.5 rounded-full bg-current opacity-70" />
      {ORDER_STATUS_LABELS[status]}
    </span>
  );
}

export function FlyerStatusBadge({ status, className }: { status: FlyerStatus; className?: string }) {
  return (
    <span className={cn('status-pill', FLYER_STATUS_CLASSES[status], className)}>
      <span className="h-1.5 w-1.5 rounded-full bg-current opacity-70" />
      {FLYER_STATUS_LABELS[status]}
    </span>
  );
}
