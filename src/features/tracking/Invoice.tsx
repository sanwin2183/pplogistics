import { useRef } from 'react';
import { Image as ImageIcon, Package, Printer } from 'lucide-react';
import { Button } from '../../components/ui/button';
import { Spinner } from '../../components/Spinner';
import { fmtDate, fmtKg, fmtMoney } from '../../lib/formatters';
import { ORDER_STATUS_LABELS } from '../../lib/status';
import { useSaveDocAsImage } from './useSaveDocAsImage';
import type { PaymentMethod, PublicOrder } from '../../types';

/**
 * Invoice for unpaid orders (pending → awaiting_payment).
 *
 * Renders TWO copies of the document:
 *
 *   1. On-screen .card-soft card — responsive, sits in the 480 px mobile
 *      column, contains the [Save as image] [Print / PDF] action toolbar
 *      anchored at the bottom. Tagged .print-screen-hidden so @media print
 *      hides it.
 *
 *   2. Off-screen .doc-page-a4 element — full A4 portrait (210 × 297 mm)
 *      with payment block included (QR + bank/account info from
 *      order.paymentMethods). useSaveDocAsImage targets THIS element so the
 *      captured JPG is a proper full-page invoice with everything the
 *      customer needs (amount due + how to pay + QR) in one image. In
 *      @media print this element promotes from `position: fixed` to
 *      `position: static` so it flows into the printed page.
 *
 * IMAGES on the A4 doc — server-prefetched data URIs
 *   business.logoDataUri and paymentMethods[].qrDataUri are inlined by
 *   the getTrackingOrder Cloud Function (server-side fetch + base64).
 *   The A4 doc renders <img> from those data URIs so iOS Safari's
 *   capture pipeline doesn't have to fetch cross-origin Storage bytes
 *   (default bucket CORS blocks fetch — <img> displays but fetch()
 *   rejects with TypeError: Failed to fetch). On-screen card uses the
 *   raw URL because display-time <img> rendering doesn't go through
 *   fetch.
 *
 * §11: reads only fields already on PublicOrder (paymentMethods is the
 * sanitized list of enabled methods — accountName/accountNumber/bank/
 * qrUrl/qrDataUri/isActive; no payouts, no profit; customerFirstName
 * not full PII). No leakage.
 */
export function Invoice({ order }: { order: PublicOrder }) {
  const docRef = useRef<HTMLDivElement | null>(null);
  const { save, saving } = useSaveDocAsImage(`invoice-${order.orderNumber}`);

  return (
    <>
      {/* 1. ON-SCREEN card — interactive copy. */}
      <section className="card-soft print-screen-hidden p-6 space-y-5">
        <InvoiceBody order={order} mode="screen" />

        {/* Save / print toolbar — captured-skip + no-print + at the bottom
            of the on-screen card so it's visually anchored to the document. */}
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

      {/* 2. OFF-SCREEN A4 doc — capture + print target. aria-hidden so
          screen readers ignore the duplicate content. */}
      <div ref={docRef} className="doc-page-a4 space-y-6" aria-hidden="true">
        <InvoiceBody order={order} mode="a4" />
      </div>
    </>
  );
}

/**
 * Shared invoice body. mode='screen' uses the raw Storage URLs for
 * images (live display is CORS-free); mode='a4' uses the inlined data:
 * URIs returned by the function so the capture + print paths don't
 * depend on a cross-origin fetch.
 */
function InvoiceBody({ order, mode }: { order: PublicOrder; mode: 'screen' | 'a4' }) {
  const logoSrc =
    mode === 'a4'
      ? (order.business.logoDataUri ?? null)
      : (order.business.logoUrl ?? null);

  return (
    <>
      {/* Header — title + logo */}
      <header className="flex items-start justify-between gap-3 border-b border-border pb-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Invoice</h1>
          <p className="mt-0.5 text-xs text-muted-foreground tabular-nums">#{order.orderNumber}</p>
        </div>
        {logoSrc ? (
          <img src={logoSrc} alt={order.business.name} className="h-10 max-w-[7rem] object-contain" />
        ) : (
          // No logo URL (or A4 mode + server fetch failed → null data URI)
          // → fall back to the package icon.
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

      {/* Line-items table */}
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

      {/* Payment block — A4 doc only. Lists every active payment method
          with its server-inlined QR (when set) + account name / number /
          bank. */}
      {mode === 'a4' && <PaymentMethodsForDoc order={order} />}
    </>
  );
}

/** Type label per method type — matches the on-screen PaymentSection. */
const TYPE_LABEL: Record<PaymentMethod['type'], string> = {
  promptpay: 'PromptPay',
  bank_transfer: 'Bank Transfer',
  kbz_pay: 'KBZ Pay',
  wave_pay: 'Wave Pay',
};

/**
 * Per-method payment block — A4 doc only. Renders the server-prefetched
 * QR data URI for each active method, falling back to a "QR unavailable
 * - use account details ->" box when the server-side fetch failed (the
 * account name/number rows on the right still let the customer pay).
 */
function PaymentMethodsForDoc({ order }: { order: PublicOrder }) {
  const methods = order.paymentMethods.filter((m) => m.isActive);
  if (methods.length === 0) return null;

  return (
    <section className="rounded-lg border border-border bg-secondary/40 p-4 space-y-4">
      <div>
        <h3 className="text-sm font-semibold tracking-wider text-foreground">HOW TO PAY</h3>
        <p className="mt-0.5 text-xs text-muted-foreground">
          Pay {fmtMoney(order.totalAmount)} using any of the methods below. Include order #{order.orderNumber} as the reference.
        </p>
      </div>
      <div className="space-y-4">
        {methods.map((m) => {
          const qrSrc = m.qrDataUri ?? null;
          return (
            <div key={m.id} className="flex items-start gap-4 rounded-md border border-border bg-card p-3">
              {qrSrc ? (
                // White-backed 128x128 box. Inner wrapper enforces an
                // explicit pixel square so html2canvas can't introduce
                // aspect-ratio distortion via its imperfect object-fit
                // handling — the <img> itself carries explicit width AND
                // height HTML attributes plus inline pixel-sized style,
                // and the re-encode pass pads any non-square QR source
                // to a true square before we get here. Belt-and-braces.
                <div className="shrink-0 rounded-md border border-border bg-white p-1.5">
                  <div style={{ width: '128px', height: '128px' }}>
                    <img
                      src={qrSrc}
                      alt={`${m.label} QR code`}
                      width={128}
                      height={128}
                      style={{
                        width: '128px',
                        height: '128px',
                        objectFit: 'contain',
                        display: 'block',
                      }}
                    />
                  </div>
                </div>
              ) : m.qrUrl ? (
                // qrUrl was set but the server-side fetch failed → graceful
                // fallback so account name/number remain front-and-centre.
                // Save / Print NEVER hard-fail because of this.
                <div className="flex h-32 w-32 shrink-0 items-center justify-center rounded-md border border-dashed border-border bg-muted/40 p-2 text-center text-[11px] text-muted-foreground">
                  QR unavailable — use account details &rarr;
                </div>
              ) : null /* no QR configured for this method */}
              <div className="min-w-0 flex-1 space-y-1 text-sm">
                <div className="font-semibold">{TYPE_LABEL[m.type] ?? m.label}</div>
                <DocDetailRow label="Account name" value={m.accountName} />
                <DocDetailRow
                  label={m.type === 'bank_transfer' ? 'Account number' : 'Number'}
                  value={m.accountNumber}
                />
                {m.bank && <DocDetailRow label="Bank" value={m.bank} />}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function DocDetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-wrap justify-between gap-x-3 gap-y-0.5">
      <span className="text-xs uppercase tracking-wider text-muted-foreground">{label}</span>
      <span className="text-sm font-medium tabular-nums">{value}</span>
    </div>
  );
}
