import { useRef } from 'react';
import { Image as ImageIcon, Package, Printer } from 'lucide-react';
import { Button } from '../../components/ui/button';
import { Spinner } from '../../components/Spinner';
import { fmtDate, fmtKg, fmtMoney } from '../../lib/formatters';
import { ORDER_STATUS_LABELS } from '../../lib/status';
import { useSaveDocAsImage } from './useSaveDocAsImage';
import type { PublicOrder } from '../../types';

/**
 * Invoice card for unpaid orders (pending → awaiting_payment).
 *
 * Layout adapted from a standard service invoice but tuned to this business's
 * hand-carry model: line items show Description / Category / Weight / Rate /
 * Line total, then a prominent "Total amount due" at the bottom. The companion
 * <PaymentSection /> renders directly below with bank/QR details — together
 * they form the customer's complete bill.
 *
 * Distinct from <Receipt /> (rendered at status='paid') so the heading and
 * copy never imply "paid" before admin approval.
 *
 * Save / print:
 *   - "Save as image" captures the .print-doc subtree via html-to-image (see
 *     useSaveDocAsImage) and hands it to the iOS share sheet (Save to Photos)
 *     or a download link.
 *   - "Print / save as PDF" uses window.print() with the @media print rules
 *     in index.css that scope output to .print-doc only.
 */
export function Invoice({ order }: { order: PublicOrder }) {
  const docRef = useRef<HTMLElement | null>(null);
  const { save, saving } = useSaveDocAsImage(`invoice-${order.orderNumber}`);

  return (
    <section ref={docRef} className="card-soft print-doc p-6 space-y-5">
      {/* Header — title + logo */}
      <header className="flex items-start justify-between gap-3 border-b border-border pb-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Invoice</h1>
          <p className="mt-0.5 text-xs text-muted-foreground tabular-nums">#{order.orderNumber}</p>
        </div>
        {order.business.logoUrl ? (
          <img src={order.business.logoUrl} alt={order.business.name} className="h-10 max-w-[7rem] object-contain" />
        ) : (
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <Package className="h-5 w-5" />
          </div>
        )}
      </header>

      {/* From / Billed-to blocks */}
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
          <div className="h-eyebrow mb-1.5">Billed to</div>
          <div className="truncate text-sm font-semibold">{order.customerFirstName}</div>
        </div>
      </div>

      {/* Issued / Status meta */}
      <div className="grid grid-cols-2 gap-4">
        <div>
          <div className="h-eyebrow mb-1.5">Issued</div>
          <div className="text-sm font-medium tabular-nums">{fmtDate(order.createdAt)}</div>
        </div>
        <div>
          <div className="h-eyebrow mb-1.5">Status</div>
          <div className="text-sm font-medium">{ORDER_STATUS_LABELS[order.status]}</div>
        </div>
      </div>

      {/* Line-items table — grid-based so the description column flexes on mobile
          while the numeric columns stay tight. Colored header row per the
          reference design; bordered cells via divide-y between rows. */}
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

      {/* Totals — small weight line above the prominent amount-due billboard */}
      <div className="space-y-2">
        <div className="flex justify-between text-xs text-muted-foreground">
          <span>Total weight</span>
          <span className="tabular-nums">{fmtKg(order.totalWeightKg)}</span>
        </div>
        <div className="flex items-baseline justify-between border-t border-border pt-3">
          <span className="text-sm font-medium">Total amount due</span>
          <span className="text-2xl font-semibold tabular-nums">{fmtMoney(order.totalAmount)}</span>
        </div>
      </div>

      {/* Save / print controls — INSIDE the card so they're visually anchored
          to the invoice (not floating between two big cards above and below).
          data-capture-skip means useSaveDocAsImage's filter drops this node
          from the cloned subtree before rendering — buttons never appear in
          the saved image. .no-print keeps them out of the print output. */}
      <div
        data-capture-skip="true"
        className="no-print grid grid-cols-2 gap-2 border-t border-border pt-4"
      >
        <Button variant="outline" onClick={() => save(docRef.current)} disabled={saving}>
          {saving ? <Spinner className="text-primary" /> : <ImageIcon />}
          {saving ? 'Saving…' : 'Save as image'}
        </Button>
        <Button variant="outline" onClick={() => window.print()}>
          <Printer /> Print / PDF
        </Button>
      </div>
    </section>
  );
}
