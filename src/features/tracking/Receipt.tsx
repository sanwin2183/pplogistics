import { Printer, CheckCircle2 } from 'lucide-react';
import { Button } from '../../components/ui/button';
import { fmtDate, fmtDateTime, fmtKg, fmtMoney } from '../../lib/formatters';
import type { PublicOrder } from '../../types';

/**
 * Printable receipt — rendered when order.status === 'paid'.
 *
 * Same column layout as <Invoice /> for visual continuity (Description /
 * Category / Weight / Rate / Total), but with a "Paid" corner watermark,
 * "Total paid" instead of "Total amount due", and a confirmation footer.
 *
 * Uses window.print() with the @media print stylesheet (§9 / index.css) so
 * the owner / customer can "Save as PDF" cleanly regardless of theme.
 */
export function Receipt({ order }: { order: PublicOrder }) {
  return (
    <section className="space-y-3">
      <div className="card-soft relative overflow-hidden p-6 space-y-5">
        {/* Corner PAID stamp */}
        <div className="pointer-events-none absolute right-4 top-4 rotate-12">
          <div className="rounded-md border-2 border-status-paid-fg/60 px-3 py-1 text-xs font-bold uppercase tracking-widest text-status-paid-fg/60">
            Paid
          </div>
        </div>

        {/* Header */}
        <header className="flex items-start justify-between gap-3 border-b border-border pb-4">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Receipt</h1>
            <p className="mt-0.5 text-xs text-muted-foreground tabular-nums">#{order.orderNumber}</p>
          </div>
          {order.business.logoUrl ? (
            <img src={order.business.logoUrl} alt={order.business.name} className="h-10 max-w-[7rem] object-contain" />
          ) : (
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary text-primary-foreground">
              <CheckCircle2 className="h-5 w-5" />
            </div>
          )}
        </header>

        {/* From / Receipt-to */}
        <div className="grid grid-cols-2 gap-4">
          <div className="min-w-0">
            <div className="h-eyebrow mb-1.5">From</div>
            <div className="truncate text-sm font-semibold">{order.business.name}</div>
            {order.business.tagline && (
              <div className="truncate text-xs text-muted-foreground">{order.business.tagline}</div>
            )}
            {order.business.contactPhone && (
              <div className="truncate text-xs text-muted-foreground tabular-nums">{order.business.contactPhone}</div>
            )}
            {order.business.contactEmail && (
              <div className="truncate text-xs text-muted-foreground">{order.business.contactEmail}</div>
            )}
          </div>
          <div className="min-w-0">
            <div className="h-eyebrow mb-1.5">Receipt to</div>
            <div className="truncate text-sm font-semibold">{order.customerFirstName}</div>
          </div>
        </div>

        {/* Issued / Paid meta */}
        <div className="grid grid-cols-2 gap-4">
          <div>
            <div className="h-eyebrow mb-1.5">Issued</div>
            <div className="text-sm font-medium tabular-nums">{fmtDate(order.createdAt)}</div>
          </div>
          <div>
            <div className="h-eyebrow mb-1.5">Paid on</div>
            <div className="text-sm font-medium tabular-nums">{fmtDate(order.paidAt ?? order.paymentApprovedAt)}</div>
          </div>
        </div>

        {/* Line-items — same layout as Invoice for visual continuity */}
        <div className="overflow-hidden rounded-lg border border-border">
          <div className="grid grid-cols-[minmax(0,1fr)_auto_auto_auto] gap-3 bg-secondary px-3 py-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            <span>Item</span>
            <span className="text-right">Weight</span>
            <span className="text-right">Rate</span>
            <span className="text-right">Total</span>
          </div>
          {order.items.map((it, i) => (
            <div
              key={i}
              className="grid grid-cols-[minmax(0,1fr)_auto_auto_auto] gap-3 border-t border-border px-3 py-2.5"
            >
              <div className="min-w-0">
                <div className="truncate text-sm font-medium">{it.description}</div>
                <div className="truncate text-xs text-muted-foreground">{it.categoryName}</div>
              </div>
              <span className="self-center text-right text-xs tabular-nums">{fmtKg(it.weightKg)}</span>
              <span className="self-center text-right text-xs tabular-nums">{fmtMoney(it.ratePerKg)}</span>
              <span className="self-center text-right text-sm font-medium tabular-nums">{fmtMoney(it.subtotal)}</span>
            </div>
          ))}
        </div>

        {/* Totals — "Total paid" not "amount due" */}
        <div className="space-y-2">
          <div className="flex justify-between text-xs text-muted-foreground">
            <span>Total weight</span>
            <span className="tabular-nums">{fmtKg(order.totalWeightKg)}</span>
          </div>
          <div className="flex items-baseline justify-between border-t border-border pt-3">
            <span className="text-sm font-medium">Total paid</span>
            <span className="text-2xl font-semibold tabular-nums">{fmtMoney(order.totalAmount)}</span>
          </div>
        </div>

        {/* Confirmation + thank-you footer */}
        {order.paymentApprovedAt && (
          <p className="border-t border-border pt-3 text-center text-xs text-muted-foreground tabular-nums">
            Payment confirmed {fmtDateTime(order.paymentApprovedAt)}
          </p>
        )}
        <p className="text-center text-xs text-muted-foreground">Thank you for your business 🙏</p>
      </div>

      <Button variant="outline" className="w-full no-print" onClick={() => window.print()}>
        <Printer /> Save / print receipt
      </Button>
    </section>
  );
}
