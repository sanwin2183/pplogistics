import { Printer, CheckCircle2 } from 'lucide-react';
import { Button } from '../../components/ui/button';
import { fmtDate, fmtDateTime, fmtKg, fmtMoney } from '../../lib/formatters';
import type { PublicOrder } from '../../types';

/**
 * Printable receipt — uses the browser's native print dialog with our `@media print`
 * stylesheet so users can "Save as PDF" from any modern browser.
 */
export function Receipt({ order }: { order: PublicOrder }) {
  return (
    <section className="space-y-3">
      <div className="card-soft relative overflow-hidden p-6">
        {/* PAID stamp — corner watermark */}
        <div className="pointer-events-none absolute right-4 top-4 rotate-12">
          <div className="rounded-md border-2 border-status-paid-fg/60 px-3 py-1 text-xs font-bold uppercase tracking-widest text-status-paid-fg/60">
            Paid
          </div>
        </div>

        <header className="flex items-center gap-3 border-b border-border pb-4">
          {order.business.logoUrl ? (
            <img src={order.business.logoUrl} alt="" className="h-8 object-contain" />
          ) : (
            <div className="flex h-8 w-8 items-center justify-center rounded-md bg-primary text-primary-foreground">
              <CheckCircle2 className="h-4 w-4" />
            </div>
          )}
          <div>
            <div className="text-sm font-semibold">{order.business.name}</div>
            {order.business.tagline && (
              <div className="text-xs text-muted-foreground">{order.business.tagline}</div>
            )}
          </div>
        </header>

        <div className="mt-4 grid grid-cols-2 gap-3 text-xs">
          <div>
            <div className="h-eyebrow">Receipt</div>
            <div className="mt-0.5 font-medium tabular-nums">#{order.orderNumber}</div>
          </div>
          <div className="text-right">
            <div className="h-eyebrow">Paid on</div>
            <div className="mt-0.5 font-medium tabular-nums">{fmtDate(order.paidAt ?? order.paymentApprovedAt)}</div>
          </div>
        </div>

        <div className="my-4 h-px bg-border" />

        <ul className="space-y-1.5 text-sm">
          {order.items.map((it, i) => (
            <li key={i} className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="truncate">{it.description}</div>
                <div className="text-xs text-muted-foreground">{it.categoryName} · {fmtKg(it.weightKg)}</div>
              </div>
            </li>
          ))}
        </ul>

        <div className="mt-4 flex items-center justify-between border-t border-border pt-3">
          <span className="text-xs text-muted-foreground">Total weight</span>
          <span className="text-sm tabular-nums">{fmtKg(order.totalWeightKg)}</span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium">Total paid</span>
          <span className="text-lg font-semibold tabular-nums">{fmtMoney(order.totalAmount)}</span>
        </div>

        {order.paymentApprovedAt && (
          <p className="mt-3 text-center text-xs text-muted-foreground">
            Confirmed {fmtDateTime(order.paymentApprovedAt)}
          </p>
        )}
      </div>

      <Button variant="outline" className="w-full no-print" onClick={() => window.print()}>
        <Printer /> Save / print receipt
      </Button>
    </section>
  );
}
