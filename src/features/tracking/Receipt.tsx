import { useMemo, useRef } from 'react';
import { Printer, CheckCircle2, Image as ImageIcon } from 'lucide-react';
import { Button } from '../../components/ui/button';
import { Spinner } from '../../components/Spinner';
import { fmtDate, fmtDateTime, fmtKg, fmtMoney } from '../../lib/formatters';
import { useSaveDocAsImage } from './useSaveDocAsImage';
import {
  useImageDataUris,
  allImagesSettled,
  type ImageDataUriResult,
} from './useImageDataUris';
import type { PublicOrder } from '../../types';

/**
 * Resolve a remote image URL to the src to render. See Invoice.tsx for the
 * fuller version of this helper — same contract: data URI when ready,
 * { errored: true } on fetch failure, { src: null } while loading.
 */
function resolveImg(
  url: string | null | undefined,
  dataUriMap: Record<string, ImageDataUriResult> | undefined,
): { src: string | null; errored: boolean } {
  if (!url) return { src: null, errored: false };
  if (!dataUriMap) return { src: url, errored: false };
  const r = dataUriMap[url];
  if (r?.status === 'ready' && r.dataUri) return { src: r.dataUri, errored: false };
  if (r?.status === 'error') return { src: null, errored: true };
  return { src: null, errored: false };
}

/**
 * Receipt for paid orders (status === 'paid').
 *
 * Same dual-render shape as Invoice:
 *   1. On-screen .card-soft card with Save / Print toolbar at the bottom
 *      (tagged .print-screen-hidden so @media print hides it).
 *   2. Off-screen .doc-page-a4 — A4 portrait, captured by html-to-image
 *      and promoted to the print target by @media print rules.
 *
 * What the A4 receipt shows that the Invoice doesn't:
 *   - A prominent "PAID" corner watermark.
 *   - A "Paid via …" line derived from order.paymentProof (proof-verified
 *     vs externally marked) instead of any QR / payment-method block.
 *     The interactive PaymentSection on the public page is unmounted at
 *     status='paid' so there's nothing duplicating this anyway.
 *
 * §11: no payouts / profits / payment-proof image URL touched — we only
 * use the public `paymentApprovedAt`, the boolean presence of
 * `paymentProof` (already on PublicOrder), and `customerFirstName`.
 */
export function Receipt({ order }: { order: PublicOrder }) {
  const docRef = useRef<HTMLDivElement | null>(null);
  const { save, saving } = useSaveDocAsImage(`receipt-${order.orderNumber}`);

  // Receipt only has one remote image — the business logo. (No QR /
  // payment block on receipts.) Pre-fetched as a data: URI so the
  // capture + print paths don't depend on a cross-origin fetch.
  const imageUrls = useMemo(
    () => (order.business.logoUrl ? [order.business.logoUrl] : []),
    [order.business.logoUrl],
  );
  const dataUriMap = useImageDataUris(imageUrls);
  const ready = allImagesSettled(dataUriMap, imageUrls);

  return (
    <>
      {/* 1. ON-SCREEN card — interactive copy. */}
      <section className="card-soft print-screen-hidden relative overflow-hidden p-6 space-y-5">
        <ReceiptBody order={order} />

        {/* Save / print toolbar — captured-skip + no-print. Disabled until
            the logo has been inlined as a data URI (capture/print would
            otherwise show a broken-image placeholder). */}
        <div
          data-capture-skip="true"
          className="no-print grid grid-cols-2 gap-2 border-t border-border pt-4"
        >
          <Button
            variant="outline"
            onClick={() => save(docRef.current)}
            disabled={saving || !ready}
          >
            {(saving || !ready) ? <Spinner className="text-primary" /> : <ImageIcon />}
            {saving ? 'Saving…' : !ready ? 'Preparing…' : 'Save as image'}
          </Button>
          <Button variant="outline" onClick={() => window.print()} disabled={!ready}>
            <Printer /> {!ready ? 'Preparing…' : 'Print / PDF'}
          </Button>
        </div>
      </section>

      {/* 2. OFF-SCREEN A4 doc — capture + print target. Uses the data-URI
          logo via dataUriMap. relative so the absolute PAID stamp inside
          ReceiptBody anchors to this container, not the viewport. */}
      <div ref={docRef} className="doc-page-a4 relative space-y-6" aria-hidden="true">
        <ReceiptBody order={order} dataUriMap={dataUriMap} />
      </div>
    </>
  );
}

/**
 * Shared receipt body. The PAID corner stamp uses position:absolute, so
 * whichever wrapper renders this MUST be position-relative (the on-screen
 * card uses `relative overflow-hidden`; the A4 doc uses `relative`).
 *
 * - On-screen call: omit dataUriMap → logo renders against its original
 *   Firebase Storage URL.
 * - A4-doc call: pass dataUriMap → logo renders from inlined data: URI
 *   so capture + print don't depend on a cross-origin fetch.
 */
function ReceiptBody({
  order,
  dataUriMap,
}: {
  order: PublicOrder;
  dataUriMap?: Record<string, ImageDataUriResult>;
}) {
  const logo = resolveImg(order.business.logoUrl, dataUriMap);
  // Heuristic for the "Paid via" line — paidVia isn't in PublicOrder yet
  // (would require a function deploy), but the public response DOES
  // include the sanitized paymentProof object whenever the customer
  // uploaded a screenshot. Presence ⇒ proof-verified path; absence at
  // status='paid' ⇒ the admin used "Mark as paid (external)". The
  // function strips the image URL per §11, so we're only reading the
  // boolean existence + the customer-uploaded uploadedAt timestamp,
  // which is non-sensitive.
  const paidViaLabel = order.paymentProof
    ? 'Bank transfer / online payment (proof verified)'
    : 'Direct payment (recorded by sender)';

  return (
    <>
      {/* Corner PAID stamp */}
      <div className="pointer-events-none absolute right-6 top-6 rotate-12">
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
        {logo.src ? (
          <img
            src={logo.src}
            alt={order.business.name}
            className="h-10 max-w-[7rem] object-contain"
          />
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

      {/* Line-items */}
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

      {/* Paid-via panel — the receipt's analogue of the invoice's payment
          block. NO QR, NO bank/account details (already paid — those would
          confuse the customer about whether further payment is needed). */}
      <section className="rounded-lg border border-status-paid bg-status-paid/40 p-4">
        <div className="flex items-start gap-3">
          <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-status-paid-fg" />
          <div className="min-w-0 flex-1 space-y-1">
            <div className="text-sm font-semibold text-status-paid-fg">Payment received and confirmed</div>
            <div className="text-xs text-muted-foreground">
              Paid via {paidViaLabel}.
            </div>
            {(order.paidAt ?? order.paymentApprovedAt) && (
              <div className="text-xs text-muted-foreground tabular-nums">
                Confirmed on {fmtDateTime(order.paidAt ?? order.paymentApprovedAt)}
              </div>
            )}
          </div>
        </div>
      </section>

      {/* Thank-you footer */}
      <p className="text-center text-xs text-muted-foreground">Thank you for your business 🙏</p>
    </>
  );
}
