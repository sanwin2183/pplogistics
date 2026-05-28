import { fmtKg, fmtMoney } from '../../lib/formatters';
import type { PublicOrder } from '../../types';

/**
 * Invoice card for unpaid orders (status pending → awaiting_payment). Renders
 * an "Amount due" billboard up top, the itemized line list with per-line
 * subtotal, and a total-weight footnote.
 *
 * Distinct from <Receipt /> (rendered at status='paid') so the same surface
 * never says "paid" before the admin approves — heading stays "Amount due"
 * across every unpaid status.
 */
export function Invoice({ order }: { order: PublicOrder }) {
  return (
    <section className="card-soft p-6 space-y-5">
      <div className="text-center">
        <div className="h-eyebrow">Amount due</div>
        <div className="mt-1 text-3xl font-semibold tabular-nums">{fmtMoney(order.totalAmount)}</div>
      </div>

      <ul className="space-y-2.5 border-t border-border pt-4">
        {order.items.map((it, i) => (
          <li key={i} className="flex items-start justify-between gap-3 text-sm">
            <div className="min-w-0">
              <div className="truncate font-medium">{it.description}</div>
              <div className="text-xs text-muted-foreground">{it.categoryName} · {fmtKg(it.weightKg)}</div>
            </div>
            <span className="shrink-0 tabular-nums">{fmtMoney(it.subtotal)}</span>
          </li>
        ))}
      </ul>

      <div className="border-t border-border pt-3 flex justify-between text-xs text-muted-foreground">
        <span>Total weight</span>
        <span className="tabular-nums">{fmtKg(order.totalWeightKg)}</span>
      </div>
    </section>
  );
}
