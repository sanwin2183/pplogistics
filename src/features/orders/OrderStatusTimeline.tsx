import {
  Circle,
  CheckCircle2,
  PackageCheck,
  Plane,
  Send,
  CreditCard,
  Sparkles,
  Clock,
} from 'lucide-react';
import { cn } from '../../lib/utils';
import { fmtDateTime } from '../../lib/formatters';
import { ORDER_STATUS_LABELS, ORDER_STATUS_DESCRIPTIONS, PUBLIC_TIMELINE_STEPS } from '../../lib/status';
import type { OrderStatus, StatusHistoryEntry } from '../../types';

const STEP_ICONS: Record<OrderStatus, typeof Circle> = {
  pending: Clock,
  received: PackageCheck,
  with_flyer: Send,
  in_transit: Plane,
  delivered: CheckCircle2,
  awaiting_payment: CreditCard,
  paid: Sparkles,
};

/**
 * Vertical status timeline used by both admin OrderDetail and public Tracking page.
 *
 * - `steps`: which step labels to show. Defaults to the public-friendly 6-step view
 *   (Pending → … → Paid). Pass ORDER_STATUSES for the full admin view.
 * - `pulse`: render a pulsing ring on the current step (used on the public page).
 */
export function OrderStatusTimeline({
  status,
  history,
  steps = PUBLIC_TIMELINE_STEPS,
  pulse = false,
}: {
  status: OrderStatus;
  history: StatusHistoryEntry[];
  steps?: OrderStatus[];
  pulse?: boolean;
}) {
  const currentIdx = steps.indexOf(status);
  // Awaiting_payment is folded under Delivered visually on public page — bump idx.
  const effectiveIdx = status === 'awaiting_payment' ? steps.indexOf('delivered') : currentIdx;

  return (
    <ol className="relative">
      {steps.map((step, i) => {
        const reached = i <= effectiveIdx;
        const current = i === effectiveIdx;
        const entry = [...history].reverse().find((h) => h.status === step);
        const Icon = STEP_ICONS[step];

        return (
          <li key={step} className="relative flex gap-4 pb-6 last:pb-0">
            {/* Vertical connector */}
            {i < steps.length - 1 && (
              <span
                className={cn(
                  'absolute left-[15px] top-8 h-[calc(100%-1rem)] w-px',
                  reached ? 'bg-primary/60' : 'bg-border',
                )}
                aria-hidden
              />
            )}

            {/* Step icon */}
            <span
              className={cn(
                'relative z-10 flex h-8 w-8 shrink-0 items-center justify-center rounded-full border',
                reached ? 'bg-primary text-primary-foreground border-primary' : 'bg-background text-muted-foreground border-border',
                current && pulse && 'animate-pulse-ring',
              )}
            >
              <Icon className="h-4 w-4" strokeWidth={2.25} />
            </span>

            {/* Label */}
            <div className="min-w-0 flex-1 pt-1">
              <div className={cn('flex items-center justify-between gap-2')}>
                <span
                  className={cn(
                    'text-sm font-medium',
                    reached ? 'text-foreground' : 'text-muted-foreground',
                  )}
                >
                  {ORDER_STATUS_LABELS[step]}
                </span>
                {entry?.timestamp && (
                  <time className="text-xs tabular-nums text-muted-foreground">{fmtDateTime(entry.timestamp)}</time>
                )}
              </div>
              <p className={cn('mt-0.5 text-xs', reached ? 'text-muted-foreground' : 'text-muted-foreground/70')}>
                {entry?.note || ORDER_STATUS_DESCRIPTIONS[step]}
              </p>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
